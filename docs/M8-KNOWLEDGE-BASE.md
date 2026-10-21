# M8 — Documentation and Knowledge Base

## Scope

M8 owns the repository-document snapshot and chunk retrieval boundary. It accepts explicitly supplied Markdown/plain-text documents; it does **not** fetch arbitrary URLs, execute repository files, or write to repositories. AI answer generation remains a separate integration responsibility.

## Files added

- `src/models/RepositorySnapshot.js` — versioned snapshot provenance, visibility, import metadata and freshness.
- `src/models/DocumentChunk.js` — chunk text, source path/heading, stable chunk ID, visibility and optional embedding.
- `src/validation/documentSchemas.js` — strict Zod schemas and bounded input validation.
- `src/services/documentKnowledgeService.js` — heading-aware chunking, import, optional Ollama embeddings, Atlas Vector Search and bounded keyword fallback.
- `src/controllers/documentController.js` — stable JSON-envelope API handlers.
- `src/routes/documentRoutes.js` — authentication, verified-maintainer import and project-scope guard integration.
- `tests/m8-documents.test.js` — validation and chunking tests.

## Endpoints

All endpoints are mounted below `/api/projects/:projectId/docs`.

### `POST /import`
Requires an authenticated, verified maintainer and M4 project-access approval.

Example body:

```json
{
  "snapshotId": "demo-v1",
  "sourceUrl": "https://github.com/example/project",
  "commit": "abc123",
  "visibility": "public",
  "documents": [
    { "path": "README.md", "contentType": "text/markdown", "content": "# Setup\nInstall Node.js first." }
  ]
}
```

`sourceUrl` is provenance only and is never fetched by this endpoint. Allowed document types are Markdown/plain text. The import is bounded by document count, per-document size and aggregate characters. Re-importing an existing snapshot requires `replaceExisting: true`.

### `POST /search`
Requires authentication and M4 project-access approval.

```json
{ "question": "How do I set up the project?", "snapshotId": "demo-v1", "limit": 5 }
```

Returns `data.status = "ok"` with source references, or `data.status = "no_evidence"` with an explicit limitation. Every reference includes `chunkId`, `snapshotId`, `path`, `heading`, `score`, `excerpt`, and import timestamp. This endpoint returns evidence; it does not call a language model or generate an answer.

### `GET /snapshots`
Requires authentication and project access. Returns permitted snapshot metadata and stale flags. The default freshness threshold is seven days.

## Configuration

```env
# Optional semantic indexing; requires an Atlas Vector Search index configured for DocumentChunk.embedding.
ATLAS_VECTOR_INDEX=contrixai_document_chunks
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_EMBEDDING_MODEL=nomic-embed-text
DOCS_EMBED_ON_IMPORT=false
DOCS_QUERY_EMBEDDINGS=false
DOCS_VECTOR_FALLBACK=true
DOCS_REQUIRE_EMBEDDINGS=false
DOCS_MAX_IMPORT_CHARS=500000
DOCS_CHUNK_CHARS=3500
```

For vector retrieval, set `DOCS_EMBED_ON_IMPORT=true` and `DOCS_QUERY_EMBEDDINGS=true`, select an embedding model, and configure an Atlas Vector Search index on `embedding` with metadata filters for `projectId`, `snapshotId`, and `visibility`. Ensure the index's vector dimensions match the chosen embedding model. With embedding options disabled, bounded keyword retrieval is used.

## Required integration contract

`src/routes/documentRoutes.js` uses the existing M4 guard helpers. The host application must configure `app.locals.checkProjectAccess({ userId, projectId, roles, userRole })` using the agreed M5 membership/grant schema. This module intentionally fails closed if the checker is not configured. Do not replace this with client-supplied role or ownership fields.

M1's app mounts `/api/projects/:projectId/docs`. M10's global error middleware should remain mounted last. Confirm the project's current response-envelope/error contract before merging.

## Security and limitations

- Document content is treated as untrusted text, not instructions.
- No arbitrary URL fetch, code execution, shell, package install or repository write exists here.
- Private snapshots are only returned to their importer, moderators/admins, or verified maintainers who pass the project-scoped guard.
- Retrieval is evidence-only; the AI implementer must pass excerpts as untrusted evidence, validate model output and verify citation IDs against the selected snapshot.
- Atlas Vector Search requires an Atlas index; keyword fallback is available when the vector index/model is not configured.
- Import supports text supplied in the request. Repository cloning, archive extraction, PDF parsing, malware scanning and scheduled re-ingestion are outside this endpoint's scope and require an approved import pipeline.

## Verification

Run `npm test`. The included M8 tests cover heading-aware chunking, schema validation, unsafe paths, unexpected fields, result bounds and project-ID validation. For integration verification, test a public snapshot, a private snapshot from a different user, missing evidence, a stale snapshot, and a query across project boundaries.
