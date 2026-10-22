# ContrixAI — Open-Source Contributor Onboarding Platform
**Engineering Master Blueprint • Edition 3.0 Full Integration (M1–M10 & D1–D3)**

ContrixAI is an AI-assisted open-source contributor onboarding portal built with **React/Tailwind, Node.js, Express, Mongoose, MongoDB Atlas & Atlas Vector Search, Ollama, LangChain JavaScript, and Zod**. 

It helps student contributors discover suitable beginner-friendly issues, navigate documentation snapshots, ask citable repository questions, and draft structured contribution plans with verifiable evidence before maintainers assign tasks.

---

## 🌟 Key Architecture & Responsibilities

The repository is cleanly partitioned into `frontend/` and `backend/` directories with a **single unified `package.json`** at the project root:

- **`frontend/`**: Pure HTML, CSS, and Tailwind CSS client providing real-time responsive dashboards for Contributors, Maintainers, and Moderators without heavy toolchains.
- **`backend/`**: Pure JavaScript Node.js / Express backend (100% JavaScript, zero Python) powering authenticated APIs, semantic issue matching, vector documentation RAG, and an autonomous 5-tool onboarding agent.

| Lane | Role | Core Files | Responsibility |
|---|---|---|---|
| **M1** | Lead / Core Server & Integrator | `backend/src/server.js`, `backend/src/app.js`, `backend/src/config/db.js` | Express app skeleton, DB connection lifecycle, CORS, rate-limiting, router mounts, UI static file serving, `GET /api/health`. |
| **M2** | Authentication Controller & Routes | `backend/src/controllers/authController.js`, `backend/src/routes/authRoutes.js` | Verified email signup, constant-time password comparison, session management, password recovery, `GET /api/auth/me`. |
| **M3** | User & Identity Data Models | `backend/src/models/User.js`, `backend/src/models/Organization.js` | User schema with bounded skills/interests/availability, `PROFILE_FIELDS` whitelist helper, safe updates. |
| **M4** | Access Control Guards | `backend/src/middleware/authGuards.js`, `authMiddleware.js`, `roleMiddleware.js` | Session resolution, role checks (`contributor`, `maintainer`, `moderator`), CSRF protection, server-side project scope guards. |
| **M5** | Memberships & Plan Models | `backend/src/models/Membership.js`, `backend/src/models/Plan.js` | Project membership tracking, ContributionPlan schema, explicit state transition machine (`draft` -> `submitted` -> `approved` / `rejected` / `needs_changes`). |
| **M6** | Contribution Plan API | `backend/src/controllers/planController.js`, `backend/src/routes/planRoutes.js`, `backend/src/models/Entitlement.js` | Plan creation, editing, submission, maintainer review (no self-review), snapshot evidence resolution. |
| **M7** | Ticketing & Issue Management | `backend/src/models/Ticket.js`, `backend/src/controllers/ticketController.js`, `backend/src/routes/ticketRoutes.js` | Approved project and issue browsing, contributor interest registration, maintainer issue assignment, `getIssueAvailability`. |
| **M8** | Help Desk & Knowledge Base | `backend/src/models/HelpArticle.js`, `backend/src/controllers/helpController.js`, `backend/src/routes/helpRoutes.js` | Heading-aware Markdown chunking, documentation browsing, bounded citable search, graceful no-evidence contract. |
| **M9** | Incidents & System Status | `backend/src/models/Incident.js`, `backend/src/controllers/statusController.js`, `backend/src/routes/statusRoutes.js` | Computed dependency status (`healthy` / `degraded` / `unavailable`), Ollama / DB ping, snapshot freshness checks (>7 days stale warning). |
| **M10** | Seeder & Central Error Middleware | `backend/src/middleware/errorMiddleware.js`, `backend/src/seed/seedData.js`, `backend/src/seed/seedAdapter.js` | Centralized JSON error envelopes (RFC 7807 inspired), idempotent seed with negative fixtures (assigned issue, private project, prompt-injection fixture). |
| **D1** | AI & Retrieval Engine | `backend/src/services/aiService.js`, `issueMatchingService.js`, `onboardingAgentService.js`, `backend/src/models/AgentRun.js` | 5-component weighted issue ranking (40/25/20/10/5), citation verifier, prompt isolation, fixed 5-tool onboarding agent, `POST /api/onboarding-agent`, `POST /api/ask-docs`. |
| **D2** | Clean Frontend Portal | `frontend/index.html` | Pure HTML, CSS & Tailwind CSS single-page interface for contributor dashboard, issue discovery, documentation RAG, starter plans, maintainer reviews & moderator console. |
| **D3** | Project & Snapshot Storage | `backend/src/models/Project.js`, `backend/src/models/RepositorySnapshot.js`, `backend/src/models/DocumentChunk.js` | Storage for snapshots, document chunks with vector embeddings, `POST /api/projects/:id/imports`. |

---

## 🔒 Seven Golden Rules Enforced

1. **AI suggests, never executes:** No uploaded code execution, no git push, no repository writes, no shell.
2. **Server decides access:** Hiding UI elements is not authorization; every route and tool call is guarded server-side.
3. **Repository text is untrusted data, not authority:** READMEs and issue bodies are delimited as untrusted quotes; prompt injection attempts are safely ignored.
4. **Cite it or say you can't:** Every docs answer and plan cites verified chunk IDs from a named snapshot; missing evidence yields an explicit limitation.
5. **Stay in your lane:** Clean modular structure preserves M1–M10 boundaries.
6. **Demo the unhappy path:** The AI onboarding agent detects when the top candidate issue is already assigned, skips it, explains the reason, recommends an open alternative, and lists setup prerequisites first.
7. **Identity strictly from session:** Request bodies cannot spoof `userId`, `role`, or `reviewerId`.

---

## 🚀 Quickstart & Verification

### 1. Requirements
- Node.js ≥ 20.x
- npm
- Local MongoDB (or MongoDB Atlas cluster)
- Ollama (optional, with `qwen:4b` and `embeddinggemma`)

### 2. Installation
```bash
npm install
```

### 3. Environment Setup
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
*(All variables in `.env.example` have working defaults for local development and testing).*

### 4. Running the Complete Verification Suite
```bash
# Check syntax of all files across M1-M10 & D1-D3:
npm run check

# Run all 179 unit, security, and integration tests:
npm test
```

### 5. Running the Application
```bash
npm start
```
- Open `http://localhost:4000/` or `http://localhost:4000/app` in your browser.
- Health check: `GET http://localhost:4000/api/health`
- System status: `GET http://localhost:4000/api/status`

### 6. Demo Login Credentials

The initial login screen supports one-click demo login or manual credentials:

| Role | Email | Password | Destination Dashboard |
|---|---|---|---|
| **Contributor** | `contributor@gmail.com` | `contributor@123` | Contributor Dashboard (Issue matching, Docs RAG, Starter Plans) |
| **Maintainer** | `maintainer@gmail.com` | `maintainer@123` | Maintainer Dashboard (Review Inbox, Task Assignment, Imports) |
| **Moderator** | `moderator@gmail.com` | `moderator@123` | Moderator Console (Project Verification, Incidents) |

---

## 📋 Acceptance & Testing Matrix (T01 – T23)

All 23 formal blueprint acceptance tests are covered and passing (179 tests total):
- **T01 (Boot)**: Clean boot and `/api/health` responds.
- **T02 (Auth)**: Signup with `role: 'maintainer'` safely forces `contributor`.
- **T03 (Auth)**: Generic response on invalid email or password prevents user enumeration.
- **T04 (Guard)**: Unauthenticated requests return `401 UNAUTHENTICATED`.
- **T05 (Guard)**: Contributor or maintainer cannot review their own plan (`403 FORBIDDEN`).
- **T06 (Guard)**: Contributors cannot call maintainer snapshot import routes (`403 FORBIDDEN`).
- **T07 (Guard)**: Maintainers cannot mutate issues or review plans of other projects (`403` / `404`).
- **T08 (Plans)**: Contributor B cannot read or edit Contributor A's draft plan.
- **T09 (Plans)**: Editing an already-submitted plan returns `409 CONFLICT`.
- **T10 (Plans)**: Evidence references outside the plan's snapshot are rejected.
- **T11 (Issues)**: Availability check reports assigned issues as `ASSIGNED`, never available.
- **T12 (Issues)**: Duplicate active interest returns `409 CONFLICT`.
- **T13 (Issues)**: Huge query limits (`limit=10000`) are safely capped to 50.
- **T14 (Docs)**: Private snapshots are completely concealed from anonymous search.
- **T15 (Docs)**: Missing documentation returns a graceful `no_evidence` result without hallucinating.
- **T16 (AI Safety)**: Prompt injections inside README chunks are treated strictly as data; secrets never leak.
- **T17 (AI Safety)**: Hallucinated chunk IDs are rejected or stripped by the citation verifier.
- **T18 (AI Ops)**: Direct model call returns `503 AI_UNAVAILABLE` when Ollama is offline while the rest of the application remains functional.
- **T19 (Status)**: Model outage marks `/api/status` as degraded with a visible incident.
- **T20 (Errors)**: Malformed JSON body returns `400 INVALID_JSON` in standard envelope.
- **T21 (Errors)**: In production mode (`NODE_ENV=production`), no stack traces are exposed.
- **T22 (Seed)**: Deterministic idempotent seeding refuses execution against production databases.
- **T23 (Demo)**: Onboarding agent skips the assigned issue (#A) and selects the open alternative (#B) with setup prerequisites.
