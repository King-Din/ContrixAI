
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  validateSeedSafety,
  validateDemoCredentials,
  seedFixtureManifest
} = require("../src/seed/seedData");

const safeEnv = {
  NODE_ENV: "development",
  SEED_CONFIRM: "YES",
  MONGODB_URI: "mongodb://localhost:27017/contrixai_demo",
  SEED_DB_NAME: "contrixai_demo",
  SEED_CONTRIBUTOR_EMAIL: "contributor@example.test",
  SEED_CONTRIBUTOR_PASSWORD: "test-only-contributor-password",
  SEED_MAINTAINER_EMAIL: "maintainer@example.test",
  SEED_MAINTAINER_PASSWORD: "test-only-maintainer-password",
  SEED_MODERATOR_EMAIL: "moderator@example.test",
  SEED_MODERATOR_PASSWORD: "test-only-moderator-password"
};

test("rejects production seeding", () => {
  assert.throws(
    () => validateSeedSafety({ ...safeEnv, NODE_ENV: "production" }),
    /disabled in production/
  );
});

test("requires explicit seed confirmation", () => {
  assert.throws(
    () => validateSeedSafety({ ...safeEnv, SEED_CONFIRM: "" }),
    /explicit confirmation/
  );
});

test("requires MongoDB URI and database name", () => {
  assert.throws(
    () => validateSeedSafety({ ...safeEnv, MONGODB_URI: "" }),
    /must be configured/
  );
});

test("requires the URI database to match the configured database", () => {
  assert.throws(
    () => validateSeedSafety({
      ...safeEnv,
      MONGODB_URI: "mongodb://localhost:27017/another_db"
    }),
    /must match SEED_DB_NAME/
  );
});

test("rejects databases not named dev, demo, or test", () => {
  assert.throws(
    () => validateSeedSafety({
      ...safeEnv,
      SEED_DB_NAME: "contrixai",
      MONGODB_URI: "mongodb://localhost:27017/contrixai"
    }),
    /only for a database named/
  );
});

test("accepts a correctly configured disposable database", () => {
  assert.doesNotThrow(() => validateSeedSafety(safeEnv));
});

test("requires all demo credential environment variables", () => {
  assert.throws(
    () => validateDemoCredentials({}),
    /Missing demo credential/
  );
});

test("accepts complete demo credentials", () => {
  assert.doesNotThrow(() => validateDemoCredentials(safeEnv));
});

test("defines the required demo fixture categories", () => {
  assert.ok(seedFixtureManifest.users.length >= 3);
  assert.ok(seedFixtureManifest.projects.some((p) => p.visibility === "public"));
  assert.ok(seedFixtureManifest.projects.some((p) => p.visibility === "private"));
  assert.ok(seedFixtureManifest.snapshots.length > 0);
  assert.ok(seedFixtureManifest.documents.length > 0);
  assert.ok(seedFixtureManifest.chunks.length > 0);
  assert.ok(seedFixtureManifest.issues.some((i) => i.state === "open"));
  assert.ok(seedFixtureManifest.issues.some((i) => i.state === "assigned"));
  assert.ok(seedFixtureManifest.interests.length > 0);
  assert.ok(seedFixtureManifest.plans.length > 0);
});

test("includes a prompt-injection negative fixture", () => {
  assert.ok(
    seedFixtureManifest.chunks.some(
      (chunk) => chunk.kind === "prompt_injection_negative_fixture"
    )
  );
});
