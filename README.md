# ContrixAI Backend — M1 Bootstrap

This folder contains the **M1-owned bootstrap files**: the server entry point,
database connection helper, app-level middleware/configuration, environment
template, package scripts, request ID handling, health endpoint, and integration
notes.

> This is the runnable bootstrap, not the complete project. M2–M10 still need
> to publish their agreed routers, models, guards, validation and shared error
> middleware. Do not treat placeholder/bootstrap behavior as final production
> behavior.

## Requirements

- Node.js 20 or newer
- npm
- MongoDB Atlas cluster (or another MongoDB URI accepted by Mongoose)
- Git

## Run locally

1. Open this folder in VS Code.
2. Install packages:

   ```bash
   npm install
   ```

3. Copy `.env.example` to `.env` (Windows PowerShell):

   ```powershell
   Copy-Item .env.example .env
   ```

   On macOS/Linux:

   ```bash
   cp .env.example .env
   ```

4. Replace the `MONGODB_URI` placeholder in `.env` with your own Atlas connection
   string. URL-encode special characters in the database password if needed.
5. Start the development server:

   ```bash
   npm run dev
   ```

6. Open `http://localhost:4000/api/health`. A successful database connection
   should return JSON with `data.status` set to `healthy`.

## Useful commands

```bash
npm run dev
npm start
npm run check
```

## Initial endpoints

- `GET /` — basic API-running response
- `GET /api/health` — bootstrap health check; requires MongoDB to be connected
- Unknown paths — standard-shaped `404 NOT_FOUND` response

## Response envelope

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

M10's finalized error middleware and the team-approved contract take precedence
when integrated.

## M1 integration responsibilities

- Keep `src/server.js` and `src/config/db.js` as the common startup/DB entry.
- Maintain `.env.example` with placeholder values only.
- Coordinate package dependencies and scripts; resolve dependency conflicts
  with the team.
- Mount finalized routers from M2–M10 in `src/app.js` after owners publish
  their stable export names.
- Keep middleware ordering correct: request ID → security/CORS/body parsing →
  rate limiting → routers → 404 → shared error middleware.
- Run a clean-clone install, startup and smoke test before approving merges.

## Security reminders

- Never commit `.env`, database credentials, passwords, tokens, repository
  snapshots, or real user data.
- Do not log connection strings or secrets.
- Keep `main` protected; work on your assigned branch and use a PR.
- Do not edit another member's lane without their approval.
