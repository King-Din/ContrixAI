# ContrixAI M10 contribution

This folder contains the M10-owned error middleware, guarded seed runner, deterministic fixture manifest, and Node.js built-in tests. It intentionally does not replace the rest of the ContrixAI repository.

## Files

- `src/middleware/errorMiddleware.js` — centralized API error envelope and mappings.
- `src/seed/seedData.js` — production/database/confirmation guards, environment-only demo credential checks, deterministic seed fixture manifest, and adapter entry point.
- `tests/m10.test.js` — unit tests using Node's built-in test runner.

## Install into the existing repository

Copy the included `src/middleware/errorMiddleware.js`, `src/seed/seedData.js`, and `tests/m10.test.js` into the same paths in the existing repository. Keep the existing `src/app.js` change that mounts `errorMiddleware` last. Do not replace shared files not included here.

## Run tests

```bash
node --test tests/m10.test.js
```

## Seed safety

The seed runner refuses to run in production, requires `SEED_CONFIRM=YES`, requires `MONGODB_URI` and `SEED_DB_NAME` to match, and only permits database names containing `dev`, `demo`, or `test`. Demo emails and passwords must be supplied through environment variables; passwords are never printed.

Example `.env` values (use disposable demo credentials only; do not commit `.env`):

```dotenv
NODE_ENV=development
MONGODB_URI=mongodb://127.0.0.1:27017/contrixai_demo
SEED_DB_NAME=contrixai_demo
SEED_CONFIRM=YES
SEED_CONTRIBUTOR_EMAIL=contributor@example.test
SEED_CONTRIBUTOR_PASSWORD=replace-with-a-local-demo-password
SEED_MAINTAINER_EMAIL=maintainer@example.test
SEED_MAINTAINER_PASSWORD=replace-with-a-local-demo-password
SEED_MODERATOR_EMAIL=moderator@example.test
SEED_MODERATOR_PASSWORD=replace-with-a-local-demo-password
```

## Integration limitation

The checked-out repository currently has no merged User/Auth, Project, Snapshot, DocumentChunk, Issue, Interest, or Plan model contracts. Therefore this contribution does **not** guess database field names or password hashing. The seed runner includes the blueprint's deterministic fixture manifest but refuses to write until a project-approved `seedAdapter.js` exists and implements `seed({ manifest, env })`. After model/auth contracts are merged, implement that adapter using the agreed model APIs and password-hashing contract, then test two consecutive runs for idempotency. Do not mark the complete M10 seeder done until this integration step and its tests pass.
