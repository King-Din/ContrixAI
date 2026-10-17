# ContrixAI Integration Checklist — M1/M3/M4/M10

## M1 — bootstrap
- [ ] Clean clone installs with `npm install`.
- [ ] `MONGODB_URI` is configured locally and is never committed.
- [ ] Server starts only after DB connection succeeds.
- [ ] `GET /api/health` reports database state.
- [ ] Request ID, Helmet, CORS, JSON limit and rate limiting are configured.
- [ ] Final M10 error middleware is mounted last.
- [ ] Unknown paths return the stable `404 NOT_FOUND` envelope.
- [ ] No DNS servers, secrets or provider endpoints are hard-coded.

## M3 — identity model
- [ ] User fields are frozen: name, normalized unique email, passwordHash (`select:false`), role, emailVerified, maintainerVerified, isActive, skills, interests, availability.
- [ ] Roles are contributor, maintainer, moderator.
- [ ] Matching/profile fields are bounded and validated.
- [ ] `PROFILE_FIELDS` and `pickProfileUpdates` only allow name, skills, interests, availability.
- [ ] Tests pass for defaults, indexes, field bounds and protected-field exclusion.
- [ ] Team decision about conditional `Organization.js` is recorded.

## M4 — access control
- [ ] M2's session middleware stores the user ID server-side as `req.session.userId`.
- [ ] `loadAuthContext` loads role/verification state from the database.
- [ ] `requireAuth`, `requireRole`, `requireCsrf`, `requireVerifiedEmail`, and `requireVerifiedMaintainer` return 401/403 correctly.
- [ ] M5/team supplies `app.locals.checkProjectAccess` using the final membership/grant schema.
- [ ] Project-scope checks fail closed and never trust body-supplied identity/role/grants.
- [ ] Agent-tool checklist is reviewed before tools are exposed.
- [ ] Cross-user and cross-project negative tests pass.

## M10 — errors and seed
- [ ] Malformed JSON -> `400 INVALID_JSON`.
- [ ] Validation/cast errors -> `400 VALIDATION_ERROR`.
- [ ] Duplicate key -> `409 CONFLICT`.
- [ ] Auth/access errors -> `401 UNAUTHENTICATED` / `403 FORBIDDEN`.
- [ ] Unknown resource -> `404 NOT_FOUND`.
- [ ] Rate limit -> `429 RATE_LIMITED`.
- [ ] AI provider unavailable -> `503 AI_UNAVAILABLE`.
- [ ] Responses do not expose stack traces, secrets or raw provider errors.
- [ ] Seeder refuses production and requires explicit confirmation plus a disposable dev/demo/test DB.
- [ ] Final seed adapter is not enabled until all domain model contracts and approved password hashing are integrated.
- [ ] Seed data includes the assigned issue + alternative open issue and negative fixtures after contracts land.

## Merge order
1. M1/M3/M10 foundation and stable User/error contracts.
2. M4 guard contracts; coordinate with M2's auth/session behavior and M5's membership model.
3. M2 auth implementation and M5 model contracts.
4. Integrate M4 guards with actual session and membership contracts.
5. Finish M10 seeder when all required models and password hashing are available.
6. M1 runs clean-clone install, tests, health, unknown-route and auth smoke checks before release.
