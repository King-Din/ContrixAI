# ContrixAI Backend — M1/M3/M4/M10 Foundation

This archive consolidates the available Stage-1 repository with the M3 User model, M4 access-control guards, and M10 centralized error handling and seed-safety scaffolding. It is **not the complete ContrixAI application**: M2 authentication implementation and several domain model contracts are still owned by other members.

## Requirements

- Node.js 20 or newer
- npm
- MongoDB Atlas or another MongoDB URI supported by Mongoose
- Git

## Setup

1. Extract the ZIP and open the `ContrixAI-main` folder in VS Code.
2. Install dependencies:

   ```bash
   npm install
   ```

3. Copy `.env.example` to `.env` and set `MONGODB_URI` to your own development database. Never commit `.env`.
4. Start the API:

   ```bash
   npm run dev
   ```

5. Test `GET http://localhost:4000/api/health`.

The server deliberately refuses to start without a configured MongoDB URI and successful DB connection.

## Available routes

- `GET /` — basic API-running response
- `GET /api/health` — bootstrap database health
- `/api/auth/*` — mounted M2 route placeholders; these currently return `501 NOT_IMPLEMENTED` until M2 completes authentication
- Unknown routes — stable `404 NOT_FOUND` response

## M1 files

- `src/server.js`: startup, required environment validation, DB connection and graceful shutdown
- `src/app.js`: middleware ordering, CORS, request IDs, rate limiting, route mounts, 404 and final error handler
- `src/config/db.js`: MongoDB connect/disconnect helpers
- `src/routes/healthRoutes.js`: bootstrap health endpoint; M9 must extend it for full system status
- `.env.example`: placeholder-only environment contract

The server does not override operating-system DNS servers. Keep deployment networking in environment/infrastructure configuration.

## M3 files

- `src/models/User.js`: normalized unique email, password hash excluded from normal queries, approved role enum, verification/active flags, bounded skills/interests/availability, indexes, timestamps and strict schema
- `PROFILE_FIELDS`: stable profile field list
- `pickProfileUpdates(input)`: only returns approved profile fields and excludes role, verification, active-state and password fields
- `src/models/User.test.js`: schema contract tests

`Organization.js` is not included because the Edition 3.0 blueprint makes it conditional on a team decision. Record that decision before adding/removing the model.

## M4 files

- `src/middleware/authGuards.js`: session-backed auth-context loading, authentication, role, CSRF, verified-email, verified-maintainer and project-access guards
- `src/middleware/agentToolChecklist.md`: agent-tool authorization/security checklist
- `src/middleware/authGuards.test.js`: guard behavior tests

### M4 integration contract

M2's login flow must store the authenticated user's database ID in the **server-side** `req.session.userId`. Mount session middleware before protected routes. Never derive user identity or role from request body/query/header values.

The project-scope guard fails closed unless the app configures `app.locals.checkProjectAccess({ userId, projectId, roles, userRole })`. M5/team integration must implement that checker using the final Membership/MaintainerGrant schema; this archive intentionally does not guess a model owned by another member.

## M10 files

- `src/middleware/errorMiddleware.js`: stable shared error envelopes; maps malformed JSON, validation, duplicate-key, authentication, authorization, not-found, rate-limit and AI-provider failures
- `src/seed/seedData.js`: deterministic synthetic fixture manifest, strict production/dev-database guard and credential validation
- `src/seed/seedAdapter.js`: fails safely until the missing model/password-hashing contracts are integrated
- `tests/errorMiddleware.test.js`, `tests/m10.test.js`: error and seeding-safety tests

### Important seeder limitation

The seed manifest includes the required demo fixture categories, including public/private projects, snapshots, documents/chunks, an assigned issue, an alternative open issue, interests and a plan. The adapter **intentionally performs no database writes yet**, because this archive does not contain the approved Project, RepositorySnapshot, DocumentChunk, Issue, IssueInterest and ContributionPlan model contracts or the auth team's password-hashing service. It fails with an explicit message rather than guessing schemas, storing plain-text passwords, or leaving a partially seeded database. Integrate the model owners' contracts and approved hasher before enabling writes.

To run the seeder later, configure a disposable database whose name includes `dev`, `demo` or `test`, set `SEED_DB_NAME` to match the URI database, provide the six demo credential environment variables, and explicitly set `SEED_CONFIRM=YES`. Never run it against production.

## Commands

```bash
npm run check
npm test
npm run dev
npm run seed:demo
```

The full test suite requires successful dependency installation. `npm run seed:demo` is expected to refuse writes until the outstanding seed contracts are implemented.

## Response contract

Success:

```json
{
  "success": true,
  "data": {},
  "meta": { "requestId": "example-request-id" }
}
```

Failure:

```json
{
  "success": false,
  "message": "Human-readable explanation",
  "code": "NOT_FOUND",
  "requestId": "example-request-id"
}
```

Error responses never expose stack traces, connection strings, or raw internal error messages.

## Integration and ownership rules

- Do not replace the entire repository with a member ZIP; merge only the owned files through a feature branch/PR.
- M1 owns bootstrap and integration. Do not put domain business logic in `server.js`.
- M3 owns `User.js`; its `Organization.js` decision remains to be recorded.
- M4 owns guards and the agent-tool checklist; project access needs M5's agreed membership contract.
- M10 owns shared error handling and seeding. Final domain seeding needs all model contracts and the approved password hasher.
- Keep `main` protected. Run tests and a smoke test after each merge.
