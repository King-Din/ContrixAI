"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { User, PROFILE_FIELDS, pickProfileUpdates } = require("../src/models/User");
const { Organization } = require("../src/models/Organization");

test("M3: User schema excludes verification and reset token hashes by default", () => {
  assert.equal(User.schema.path("emailVerificationTokenHash").options.select, false);
  assert.equal(User.schema.path("emailVerificationExpires").options.select, false);
  assert.equal(User.schema.path("resetPasswordTokenHash").options.select, false);
  assert.equal(User.schema.path("resetPasswordTokenExpires").options.select, false);
});

test("M3: PROFILE_FIELDS strictly whitelist editable profile properties", () => {
  assert.deepEqual(PROFILE_FIELDS, ["name", "skills", "interests", "availability"]);
  const filtered = pickProfileUpdates({
    name: "Alex Contributor",
    role: "maintainer",
    emailVerified: true,
    maintainerVerified: true,
    isActive: false,
    skills: ["javascript", "react"],
    resetPasswordTokenHash: "attack_hash"
  });
  assert.deepEqual(filtered, {
    name: "Alex Contributor",
    skills: ["javascript", "react"]
  });
  assert.equal(filtered.role, undefined);
  assert.equal(filtered.emailVerified, undefined);
});

test("M3: Organization model initializes correctly with name and slug", async () => {
  assert.equal(Organization.modelName, "Organization");
  const org = new Organization({
    name: "ContrixAI Org",
    slug: "contrixai-org",
    description: "Sample organization"
  });
  await assert.doesNotReject(() => org.validate());
  assert.equal(org.isActive, true);
});

test("M3: Organization model requires name and slug", async () => {
  const invalidOrg = new Organization({});
  await assert.rejects(
    invalidOrg.validate(),
    (err) => err.errors.name !== undefined && err.errors.slug !== undefined
  );
});
