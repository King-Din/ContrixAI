"use strict";
const crypto = require("node:crypto");
const { DocumentChunk } = require("../models/DocumentChunk");
const { RepositorySnapshot } = require("../models/RepositorySnapshot");
const { importSchema } = require("../validation/documentSchemas");

const MAX_TOTAL_CHARS = Number(process.env.DOCS_MAX_IMPORT_CHARS) || 500000;
const CHUNK_CHARS = Math.min(10000, Math.max(800, Number(process.env.DOCS_CHUNK_CHARS) || 3500));
const EMBEDDING_MODEL = process.env.OLLAMA_EMBEDDING_MODEL || "nomic-embed-text";

function splitByHeading(path, text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const chunks = []; let heading = path; let buffer = [];
  const flush = () => {
    const content = buffer.join("\n").trim();
    if (content) chunks.push({ path, heading, content });
    buffer = [];
  };
  for (const line of lines) {
    const match = line.match(/^#{1,6}\s+(.+)$/);
    if (match && buffer.length && buffer.join("\n").length > 250) flush();
    if (match) heading = match[1].trim().slice(0, 300);
    if (buffer.join("\n").length + line.length > CHUNK_CHARS) flush();
    buffer.push(line);
  }
  flush();
  return chunks;
}
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function makeChunkId(projectId, snapshotId, path, heading, content) {
  return sha256([String(projectId), snapshotId, path, heading, content].join("\n")).slice(0, 40);
}
async function embedText(text) {
  const base = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
  const response = await fetch(`${base.replace(/\/$/, "")}/api/embed`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: text }), signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw Object.assign(new Error("Embedding provider unavailable"), { code: "AI_UNAVAILABLE", status: 503 });
  const payload = await response.json();
  const vector = payload.embeddings && payload.embeddings[0];
  if (!Array.isArray(vector) || !vector.length || vector.some((n) => !Number.isFinite(n))) {
    throw Object.assign(new Error("Embedding provider returned an invalid vector"), { code: "AI_INVALID_OUTPUT", status: 503 });
  }
  return vector;
}
async function importSnapshot({ projectId, auth, body }) {
  const parsed = importSchema.safeParse(body);
  if (!parsed.success) throw Object.assign(new Error("Invalid documentation import payload"), { status: 400, code: "VALIDATION_ERROR", details: parsed.error.issues });
  const input = parsed.data;
  if (input.sourceUrl) {
    let url;
    try { url = new URL(input.sourceUrl); } catch { throw Object.assign(new Error("sourceUrl must be a valid HTTPS URL"), { status: 400, code: "VALIDATION_ERROR" }); }
    if (url.protocol !== "https:") throw Object.assign(new Error("Only HTTPS source URLs are accepted"), { status: 400, code: "VALIDATION_ERROR" });
  }
  const total = input.documents.reduce((n, d) => n + d.content.length, 0);
  if (total > MAX_TOTAL_CHARS) throw Object.assign(new Error(`Import exceeds ${MAX_TOTAL_CHARS} character limit`), { status: 413, code: "PAYLOAD_TOO_LARGE" });
  // This endpoint accepts document text only; it never fetches sourceUrl or executes repository content.
  const existing = await RepositorySnapshot.findOne({ projectId, snapshotId: input.snapshotId });
  if (existing && !input.replaceExisting) throw Object.assign(new Error("Snapshot already exists; set replaceExisting=true to replace it"), { status: 409, code: "CONFLICT" });
  const built = input.documents.flatMap((doc) => splitByHeading(doc.path, doc.content).map((part) => ({
    projectId, snapshotId: input.snapshotId, visibility: input.visibility,
    path: part.path, heading: part.heading,
    chunkId: makeChunkId(projectId, input.snapshotId, part.path, part.heading, part.content),
    content: part.content, contentHash: sha256(part.content), importedAt: new Date()
  })));
  if (!built.length) throw Object.assign(new Error("No readable text chunks were produced"), { status: 400, code: "VALIDATION_ERROR" });
  // Compute vectors when Ollama is available; keyword retrieval remains available if it is not configured.
  if (process.env.DOCS_EMBED_ON_IMPORT === "true") {
    for (const chunk of built) {
      try { chunk.embedding = await embedText(`${chunk.heading}\n${chunk.content}`); }
      catch (error) { if (process.env.DOCS_REQUIRE_EMBEDDINGS === "true") throw error; }
    }
  }
  if (existing) {
    await DocumentChunk.deleteMany({ projectId, snapshotId: input.snapshotId });
    Object.assign(existing, { sourceUrl: input.sourceUrl, commit: input.commit, visibility: input.visibility,
      importedAt: new Date(), importedBy: auth.userId, status: "ready", documentCount: input.documents.length, chunkCount: built.length });
    await existing.save();
  } else {
    await RepositorySnapshot.create({ projectId, snapshotId: input.snapshotId, sourceUrl: input.sourceUrl,
      commit: input.commit, visibility: input.visibility, importedBy: auth.userId,
      importedAt: new Date(), status: "ready", documentCount: input.documents.length, chunkCount: built.length });
  }
  await DocumentChunk.insertMany(built, { ordered: true });
  return { snapshotId: input.snapshotId, projectId: String(projectId), visibility: input.visibility,
    documentCount: input.documents.length, chunkCount: built.length, importedAt: new Date().toISOString(), embeddingsCreated: built.filter((x) => x.embedding).length };
}
function terms(text) { return [...new Set(text.toLowerCase().match(/[a-z0-9_-]{2,}/g) || [])].slice(0, 80); }
async function retrieveDocuments({ projectId, auth, question, snapshotId, limit = 5 }) {
  const snapshots = await RepositorySnapshot.find({ projectId, ...(snapshotId ? { snapshotId } : {}) }).sort({ importedAt: -1 }).lean();
  const permitted = snapshots.filter((s) => s.visibility === "public" || (auth && (String(s.importedBy) === String(auth.userId) || auth.role === "moderator" || auth.role === "admin" || (auth.role === "maintainer" && auth.maintainerVerified && auth.projectAccess))));
  if (!permitted.length) return { status: "no_evidence", snapshotId: snapshotId || null, references: [], message: "No accessible documentation snapshot is available for this project." };
  const ids = permitted.map((s) => s.snapshotId);
  let docs = [];
  // Atlas Vector Search is used only when embeddings and an index are configured; otherwise use bounded keyword retrieval.
  if (process.env.ATLAS_VECTOR_INDEX && process.env.DOCS_QUERY_EMBEDDINGS === "true") {
    try {
      const vector = await embedText(question);
      docs = await DocumentChunk.aggregate([
        { $vectorSearch: { index: process.env.ATLAS_VECTOR_INDEX, path: "embedding", queryVector: vector, numCandidates: Math.max(50, limit * 20), limit: limit * 3,
          filter: { projectId: new (require("mongoose").Types.ObjectId)(projectId), snapshotId: { $in: ids }, visibility: { $in: permitted.map((s) => s.visibility) } } } },
        { $project: { projectId: 1, snapshotId: 1, visibility: 1, path: 1, heading: 1, chunkId: 1, content: 1, score: { $meta: "vectorSearchScore" } } }
      ]);
    } catch (error) {
      if (process.env.DOCS_VECTOR_FALLBACK === "false") throw Object.assign(new Error("Vector retrieval is unavailable"), { status: 503, code: "RETRIEVAL_UNAVAILABLE" });
    }
  }
  if (!docs.length) {
    const searchTerms = terms(question);
    const candidates = await DocumentChunk.find({ projectId, snapshotId: { $in: ids }, visibility: { $in: permitted.map((s) => s.visibility) } })
      .select("projectId snapshotId visibility path heading chunkId content importedAt").limit(1000).lean();
    docs = candidates.map((doc) => {
      const haystack = `${doc.heading} ${doc.path} ${doc.content}`.toLowerCase();
      const score = searchTerms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 + (doc.heading.toLowerCase().includes(term) ? 1 : 0) : 0), 0);
      return { ...doc, score: score / Math.max(1, searchTerms.length) };
    }).filter((doc) => doc.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
  }
  const byId = new Map(permitted.map((s) => [s.snapshotId, s]));
  const references = docs.slice(0, limit).map((d) => ({ chunkId: d.chunkId, snapshotId: d.snapshotId, path: d.path, heading: d.heading, score: Number(d.score || 0), excerpt: d.content.slice(0, 1800), importedAt: byId.get(d.snapshotId)?.importedAt || d.importedAt }));
  if (!references.length) return { status: "no_evidence", snapshotId: snapshotId || null, references: [], message: "No adequate documentation evidence was found. Import the relevant README or setup/architecture document, or ask a maintainer." };
  return { status: "ok", references, snapshotVersions: [...new Set(references.map((r) => r.snapshotId))] };
}
async function getSnapshotStatus({ projectId, auth }) {
  const snapshots = await RepositorySnapshot.find({ projectId }).sort({ importedAt: -1 }).lean();
  return snapshots.filter((s) => s.visibility === "public" || (auth && (String(s.importedBy) === String(auth.userId) || ["moderator", "admin"].includes(auth.role) || (auth.role === "maintainer" && auth.maintainerVerified && auth.projectAccess))))
    .map((s) => ({ snapshotId: s.snapshotId, visibility: s.visibility, status: s.status, importedAt: s.importedAt,
      stale: Date.now() - new Date(s.importedAt).getTime() > (s.staleAfterDays || 7) * 86400000,
      documentCount: s.documentCount, chunkCount: s.chunkCount, sourceUrl: s.sourceUrl, commit: s.commit }));
}
module.exports = { splitByHeading, importSnapshot, retrieveDocuments, getSnapshotStatus, embedText };
