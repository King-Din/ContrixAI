# M1 Integration Checklist

Use this during team kickoff and each integration PR. Follow the master
blueprint and the team's final recorded decisions if they differ from this
initial checklist.

## Before implementation merges

- [ ] Confirm the assigned branch name with the team; do not assume or overwrite
      an existing branch.
- [ ] Confirm M2–M10 router export names and route prefixes.
- [ ] Confirm the shared response envelope and error codes with M10.
- [ ] Confirm session middleware ordering with M2/M4 (session + CSRF strategy).
- [ ] Confirm final health/status behavior with M9.
- [ ] Record who owns AI/retrieval, frontend, and Project/RepositorySnapshot
      schema/import work; these are explicit blockers in the blueprint.

## Router integration

- [ ] Mount each finalized router in `src/app.js`.
- [ ] Ensure auth/session middleware is applied where required.
- [ ] Ensure route-specific validation runs before business logic.
- [ ] Keep the 404 handler after all routers.
- [ ] Keep M10's shared error middleware last.
- [ ] Do not duplicate business logic from another lane in M1 files.

## Clean-clone smoke test

- [ ] `npm install` succeeds.
- [ ] `.env.example` documents all required names with placeholders only.
- [ ] A developer's local `.env` is not tracked by Git.
- [ ] MongoDB connects with a valid local environment.
- [ ] Server starts and `GET /api/health` behaves as agreed.
- [ ] Unknown route returns the standard `404 NOT_FOUND` envelope.
- [ ] Malformed JSON returns the agreed `400 INVALID_JSON` envelope after M10
      middleware is integrated.
- [ ] At least one happy-path and one negative-path request are tested for each
      merged router.
- [ ] No secrets or stack traces leak into production responses.
- [ ] The final smoke script passes after the last merge.

## Blueprint merge order

1. M3 User stub + M10 error handler v0 + M1 skeleton/mounts.
2. M4 guard stubs/contracts + M5 model stubs + route stubs M2, M6–M9.
3. M3 full User implementation, then M2 auth.
4. M4 guards + M5 models.
5. M7 issues/availability, then M6 plans/review.
6. M8 docs search, then M9 status/freshness.
7. AI/retrieval implementation and `POST /api/onboarding-agent`.
8. M10 seed v2/negative fixtures; M1 runs smoke test, tags and freezes release.

## Important

The current M1 bootstrap includes a temporary error handler and a minimal
health endpoint. Replace/integrate them with the team's M10/M9 implementations
when those PRs are ready. Do not call the application production-ready until
the agreed auth/session, CSRF, validation, shared errors, router contracts,
tests, and release checks are implemented.
