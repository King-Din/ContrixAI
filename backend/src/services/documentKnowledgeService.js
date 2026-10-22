"use strict";

const crypto = require("node:crypto");
const mongoose = require("mongoose");
const { z } = require("zod");
const { RepositorySnapshot } = require("../models/RepositorySnapshot");
const { DocumentChunk } = require("../models/DocumentChunk");
const { importSchema } = require("../validation/documentSchemas");

function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function makeChunkId(projectId, snapshotId, path, heading, content) {
  return sha256([String(projectId), snapshotId, path, heading, content].join("\n")).slice(0, 40);
}
async function embedText(text) {
  const model = process.env.OLLAMA_EMBEDDING_MODEL || process.env.EMBEDDING_MODEL || "embeddinggemma";
  const url = `${process.env.OLLAMA_BASE_URL || "http://localhost:11434"}/api/embeddings`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt: text })
  });
  if (!res.ok) throw Object.assign(new Error(`Ollama embedding error ${res.status}`), { code: "ECONNREFUSED" });
  const data = await res.json();
  return data.embedding;
}
function splitByHeading(filePath, markdown) {
  const lines = markdown.split(/\r?\n/);
  const chunks = [];
  let heading = "Overview";
  let buffer = [];
  const maxChars = Number(process.env.DOCS_CHUNK_CHARS) || 3500;
  function flush() {
    const text = buffer.join("\n").trim();
    if (!text) return;
    for (let i = 0; i < text.length; i += maxChars) {
      chunks.push({ path: filePath, heading, content: text.slice(i, i + maxChars).trim() });
    }
    buffer = [];
  }
  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.*)$/);
    if (match) {
      flush();
      heading = match[2].trim().slice(0, 300);
    } else {
      buffer.push(line);
    }
  }
  flush();
  return chunks;
}
async function importSnapshot({ projectId, auth, body }) {
  const parsed = importSchema.safeParse(body);
  if (!parsed.success) throw Object.assign(new Error("Invalid documentation import payload"), { status: 400, code: "VALIDATION_ERROR", details: parsed.error.issues });
  const input = parsed.data;
  let existing = null;
  try {
    if (mongoose.isValidObjectId(projectId)) {
      existing = await RepositorySnapshot.findOne({ projectId, snapshotId: input.snapshotId });
    }
  } catch {}
  if (!existing && RepositorySnapshot.collection && typeof RepositorySnapshot.collection.findOne === "function") {
    try {
      existing = await RepositorySnapshot.collection.findOne({ projectId, snapshotId: input.snapshotId });
    } catch {}
  }
  if (existing && !input.replaceExisting) throw Object.assign(new Error("Snapshot already exists; set replaceExisting=true to replace it"), { status: 409, code: "CONFLICT" });
  const built = input.documents.flatMap((doc) => splitByHeading(doc.path, doc.content).map((part) => ({
    projectId, snapshotId: input.snapshotId, visibility: input.visibility,
    path: part.path, heading: part.heading,
    chunkId: makeChunkId(projectId, input.snapshotId, part.path, part.heading, part.content),
    content: part.content, contentHash: sha256(part.content), importedAt: new Date()
  })));
  if (!built.length) throw Object.assign(new Error("No readable text chunks were produced"), { status: 400, code: "VALIDATION_ERROR" });
  if (process.env.DOCS_EMBED_ON_IMPORT === "true") {
    for (const chunk of built) {
      try { chunk.embedding = await embedText(`${chunk.heading}\n${chunk.content}`); }
      catch (error) { if (process.env.DOCS_REQUIRE_EMBEDDINGS === "true") throw error; }
    }
  }
  if (existing) {
    try { await DocumentChunk.deleteMany({ projectId, snapshotId: input.snapshotId }); } catch {}
    if (DocumentChunk.collection) {
      try { await DocumentChunk.collection.deleteMany({ projectId, snapshotId: input.snapshotId }); } catch {}
    }
    Object.assign(existing, { sourceUrl: input.sourceUrl, commit: input.commit, visibility: input.visibility,
      importedAt: new Date(), importedBy: auth.userId, status: "ready", documentCount: input.documents.length, chunkCount: built.length });
    if (typeof existing.save === "function") {
      await existing.save();
    } else if (RepositorySnapshot.collection) {
      await RepositorySnapshot.collection.updateOne({ _id: existing._id }, { $set: existing });
    }
  } else {
    await RepositorySnapshot.create({ projectId, snapshotId: input.snapshotId, sourceUrl: input.sourceUrl,
      commit: input.commit, visibility: input.visibility, importedBy: auth.userId,
      importedAt: new Date(), status: "ready", documentCount: input.documents.length, chunkCount: built.length });
  }
  try {
    await DocumentChunk.insertMany(built, { ordered: true });
  } catch {
    if (DocumentChunk.collection) {
      await DocumentChunk.collection.insertMany(built);
    }
  }
  return { snapshotId: input.snapshotId, projectId: String(projectId), visibility: input.visibility,
    documentCount: input.documents.length, chunkCount: built.length, importedAt: new Date().toISOString(), embeddingsCreated: built.filter((x) => x.embedding).length };
}
function terms(text) { return [...new Set(text.toLowerCase().match(/[a-z0-9_-]{2,}/g) || [])].slice(0, 80); }
async function retrieveDocuments({ projectId, auth, question, snapshotId, limit = 5 }) {
  let snapshots = [];
  try {
    if (mongoose.isValidObjectId(projectId)) {
      snapshots = await RepositorySnapshot.find({ projectId, ...(snapshotId ? { snapshotId } : {}) }).sort({ importedAt: -1 }).lean();
    }
  } catch {}
  if (!snapshots.length && RepositorySnapshot.collection && typeof RepositorySnapshot.collection.find === "function") {
    try {
      snapshots = await RepositorySnapshot.collection.find({ projectId, ...(snapshotId ? { snapshotId } : {}) }).sort({ importedAt: -1 }).toArray();
    } catch {}
  }
  const permitted = snapshots.filter((s) => s.visibility === "public" || (auth && (String(s.importedBy) === String(auth.userId) || auth.role === "moderator" || auth.role === "admin" || (auth.role === "maintainer" && auth.maintainerVerified && auth.projectAccess))));
  if (!permitted.length) return { status: "no_evidence", snapshotId: snapshotId || null, references: [], message: "No accessible documentation snapshot is available for this project." };
  const ids = permitted.map((s) => s.snapshotId || s._id);
  let docs = [];
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
    let candidates = [];
    if (mongoose.isValidObjectId(projectId)) {
      try {
        candidates = await DocumentChunk.find({ projectId, snapshotId: { $in: ids }, visibility: { $in: permitted.map((s) => s.visibility) } })
          .select("projectId snapshotId visibility path heading chunkId content importedAt").limit(1000).lean();
      } catch {}
    }
    if (!candidates.length && DocumentChunk.collection && typeof DocumentChunk.collection.find === "function") {
      try {
        candidates = await DocumentChunk.collection.find({
          $or: [{ projectId }, { projectId: String(projectId) }],
          snapshotId: { $in: ids }
        }).limit(1000).toArray();
      } catch {}
    }
    docs = candidates.map((doc) => {
      const heading = doc.heading || "";
      const path = doc.path || "";
      const content = doc.content || doc.text || "";
      const haystack = `${heading} ${path} ${content}`.toLowerCase();
      const score = searchTerms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 + (heading.toLowerCase().includes(term) ? 1 : 0) : 0), 0);
      return { ...doc, heading, path, content, chunkId: doc.chunkId || String(doc._id), score: score / Math.max(1, searchTerms.length) };
    }).filter((doc) => doc.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
  }
  const byId = new Map(permitted.map((s) => [s.snapshotId, s]));
  const references = docs.slice(0, limit).map((d) => ({
    chunkId: d.chunkId || String(d._id),
    snapshotId: d.snapshotId,
    path: d.path,
    heading: d.heading || "",
    score: Number(d.score || 0),
    excerpt: (d.content || d.text || "").slice(0, 1800),
    importedAt: byId.get(d.snapshotId)?.importedAt || d.importedAt
  }));
  if (!references.length) return { status: "no_evidence", snapshotId: snapshotId || null, references: [], message: "No adequate documentation evidence was found. Import the relevant README or setup/architecture document, or ask a maintainer." };
  return { status: "ok", references, snapshotVersions: [...new Set(references.map((r) => r.snapshotId))] };
}
async function getSnapshotStatus({ projectId, auth }) {
  let snapshots = [];
  try {
    if (mongoose.isValidObjectId(projectId)) {
      snapshots = await RepositorySnapshot.find({ projectId }).sort({ importedAt: -1 }).lean();
    }
  } catch {}
  if (!snapshots.length && RepositorySnapshot.collection && typeof RepositorySnapshot.collection.find === "function") {
    try {
      snapshots = await RepositorySnapshot.collection.find({ projectId }).sort({ importedAt: -1 }).toArray();
    } catch {}
  }
  return snapshots.filter((s) => s.visibility === "public" || (auth && (String(s.importedBy) === String(auth.userId) || ["moderator", "admin"].includes(auth.role) || (auth.role === "maintainer" && auth.maintainerVerified && auth.projectAccess))))
    .map((s) => ({ snapshotId: s.snapshotId, visibility: s.visibility, status: s.status, importedAt: s.importedAt,
      documentCount: s.documentCount, chunkCount: s.chunkCount, stale: (Date.now() - new Date(s.importedAt).getTime()) > 7 * 86400000 }));
}
module.exports = { importSnapshot, retrieveDocuments, getSnapshotStatus, splitByHeading, embedText, terms };
