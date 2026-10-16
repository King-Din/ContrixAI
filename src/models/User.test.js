const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const { User, PROFILE_FIELDS } = require("./User");

test("User model exports the expected profile fields", () => {
  assert.deepEqual(PROFILE_FIELDS, [
    "name",
    "skills",
    "interests",
    "availability",
  ]);
});

test("User model has the correct collection model name", () => {
  assert.equal(User.modelName, "User");
});

test("role defaults to contributor", () => {
  const user = new User({
    name: "Test User",
    email: "test@example.com",
    passwordHash: "test-hash",
  });

  assert.equal(user.role, "contributor");
});

test("accepts all supported roles", async (t) => {
  for (const role of ["contributor", "maintainer", "moderator"]) {
    await t.test(role, async () => {
      const user = new User({
        name: "Test User",
        email: "test@example.com",
        passwordHash: "test-hash",
        role,
      });

      await assert.doesNotReject(() => user.validate());
    });
  }
});

test("rejects an unsupported role", async () => {
  const user = new User({
    name: "Test User",
    email: "test@example.com",
    passwordHash: "test-hash",
    role: "invalid_role",
  });

  await assert.rejects(
    user.validate(),
    (error) => error.errors.role !== undefined
  );
});

test("normalizes email to lowercase and trims whitespace", () => {
  const user = new User({
    name: "Test User",
    email: "  TEST@EXAMPLE.COM  ",
    passwordHash: "test-hash",
  });

  assert.equal(user.email, "test@example.com");
});

test("passwordHash is excluded from queries by default", () => {
  assert.equal(
    User.schema.path("passwordHash").options.select,
    false
  );
});

test("email has a unique index", () => {
  const indexes = User.schema.indexes();

  const emailIndex = indexes.find(
    ([fields, options]) =>
      fields.email === 1 && options.unique === true
  );

  assert.ok(emailIndex, "Expected a unique email index");
});

test("verification fields default to false", () => {
  const user = new User({
    name: "Test User",
    email: "test@example.com",
    passwordHash: "test-hash",
  });

  assert.equal(user.emailVerified, false);
  assert.equal(user.maintainerVerified, false);
});

test("isActive defaults to true", () => {
  const user = new User({
    name: "Test User",
    email: "test@example.com",
    passwordHash: "test-hash",
  });

  assert.equal(user.isActive, true);
});

test("skills and interests default to empty arrays", () => {
  const user = new User({
    name: "Test User",
    email: "test@example.com",
    passwordHash: "test-hash",
  });

  assert.deepEqual(user.skills, []);
  assert.deepEqual(user.interests, []);
});

test("rejects more than 30 skills", async () => {
  const user = new User({
    name: "Test User",
    email: "test@example.com",
    passwordHash: "test-hash",
    skills: Array.from({ length: 31 }, (_, i) => `skill${i}`),
  });

  await assert.rejects(
    user.validate(),
    (error) => error.errors.skills !== undefined
  );
});

test("rejects more than 20 interests", async () => {
  const user = new User({
    name: "Test User",
    email: "test@example.com",
    passwordHash: "test-hash",
    interests: Array.from({ length: 21 }, (_, i) => `interest${i}`),
  });

  await assert.rejects(
    user.validate(),
    (error) => error.errors.interests !== undefined
  );
});

test("availability defaults to an object", () => {
  const user = new User({
    name: "Test User",
    email: "test@example.com",
    passwordHash: "test-hash",
  });

  assert.ok(user.availability);
  assert.equal(user.availability.hoursPerWeek, 0);
});

test("rejects availability above 40 hours per week", async () => {
  const user = new User({
    name: "Test User",
    email: "test@example.com",
    passwordHash: "test-hash",
    availability: {
      hoursPerWeek: 50,
    },
  });

  await assert.rejects(
    user.validate(),
    (error) => error.errors["availability.hoursPerWeek"] !== undefined
  );
});

test("requires name, email and passwordHash", async () => {
  const user = new User({});

  await assert.rejects(
    user.validate(),
    (error) =>
      error.errors.name !== undefined &&
      error.errors.email !== undefined &&
      error.errors.passwordHash !== undefined
  );
});

test("schema uses timestamps and strict mode", () => {
  assert.equal(User.schema.options.timestamps, true);
  assert.equal(User.schema.options.strict, true);
});