# M6 hardening package — verification status

This package is based on the latest `ContrixAI-main(4).zip` snapshot supplied in the conversation.

## Implemented in this package
- Added `src/models/Membership.js` with M5-compatible user/project/role/status fields and a unique `(userId, projectId)` index.
- M6 create/update requests are Zod-validated; contributor identity is derived from authenticated session context.
- Plan reads and edits enforce owner access; maintainer reads/reviews require a verified maintainer with active membership in the plan's project.
- The shared `STATUS_TRANSITIONS` map is enforced for submission and review.
- Issue existence and project consistency are checked using the existing `Issue` model exported from `src/models/Ticket.js`.
- Approval fails rather than silently succeeding if the issue cannot be assigned or has an assignment conflict.
- Evidence references are checked against registered snapshot/chunk models; when D3 models are not registered, evidence-bearing requests fail closed with `INTEGRATION_NOT_READY`.

## Integration dependency still outstanding
The supplied baseline does not contain D3-owned `Project`, `RepositorySnapshot`, or `DocumentChunk` model implementations. The M6 controller supports the assumed model names/fields, but evidence validation cannot be end-to-end verified until D3's real models are integrated. Do not claim evidence validation is fully integrated until that contract is confirmed.

## Verification performed
- `npm run check`: passed (Node.js syntax checks for the project's configured files).
- Full `npm test`: not verified. Installing dependencies with `npm ci --ignore-scripts --no-audit --no-fund` timed out in this environment.
- Database-backed integration tests: not run.

## Before merging
1. Confirm D3 snapshot/chunk model names and field shapes; adjust the evidence lookup if needed.
2. Install dependencies in a normal development environment: `npm ci`.
3. Run `npm run check` and `npm test`.
4. Run integration tests against a disposable test database, including membership, cross-project evidence, and approval/assignment conflict cases.
