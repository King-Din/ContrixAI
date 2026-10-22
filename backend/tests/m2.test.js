"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const { User } = require("../src/models/User");
const {
  signup,
  login,
  logout,
  forgotPassword,
  resetPassword,
  verifyEmail,
  me
} = require("../src/controllers/authController");

function mockResponse() {
  return {
    statusCode: 200,
    body: null,
    cookiesCleared: [],
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
    clearCookie(name) {
      this.cookiesCleared.push(name);
      return this;
    }
  };
}

test("M2: T02 - Signup body with role:'maintainer' creates contributor account only", async () => {
  const originalFindOne = User.findOne;
  const originalCreate = User.create;

  let createdPayload = null;
  User.findOne = async () => null; // No existing user
  User.create = async (data) => {
    createdPayload = data;
    return {
      _id: "mock_user_123",
      ...data
    };
  };

  try {
    const req = {
      body: {
        name: "Security Tester",
        email: "test-contributor@example.com",
        password: "securePassword123!",
        role: "maintainer", // Attacker attempting role escalation
        maintainerVerified: true
      },
      requestId: "req-t02"
    };
    const res = mockResponse();
    let nextError = null;

    await signup(req, res, (err) => { nextError = err; });

    assert.equal(nextError, null);
    assert.equal(res.statusCode, 201);
    assert.equal(createdPayload.role, "contributor");
    assert.equal(createdPayload.maintainerVerified, false);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.user.role, "contributor");
    assert.equal(res.body.data.user.maintainerVerified, false);
    assert.equal(res.body.data.user.passwordHash, undefined);
  } finally {
    User.findOne = originalFindOne;
    User.create = originalCreate;
  }
});

test("M2: Signup rejects duplicate email with 409 CONFLICT", async () => {
  const originalFindOne = User.findOne;
  User.findOne = async () => ({ _id: "existing_1" });

  try {
    const req = {
      body: {
        name: "Existing Person",
        email: "already-taken@example.com",
        password: "securePassword123!"
      },
      requestId: "req-dup"
    };
    const res = mockResponse();
    await signup(req, res, () => {});

    assert.equal(res.statusCode, 409);
    assert.equal(res.body.success, false);
    assert.equal(res.body.code, "CONFLICT");
  } finally {
    User.findOne = originalFindOne;
  }
});

test("M2: Signup validation forwards Zod errors on invalid payload", async () => {
  const req = {
    body: {
      name: "A", // too short (min 2)
      email: "not-an-email",
      password: "short" // too short (min 8)
    }
  };
  const res = mockResponse();
  let caughtError = null;
  await signup(req, res, (err) => { caughtError = err; });

  assert.ok(caughtError);
  assert.equal(caughtError.name, "ZodError");
});

test("M2: T03 - Login with wrong email or wrong password returns identical generic response", async () => {
  const originalFindOne = User.findOne;
  const passwordHash = await bcrypt.hash("correctPassword123", 12);

  try {
    // 1. Wrong email: user does not exist
    User.findOne = () => ({
      select: async () => null
    });

    const resWrongEmail = mockResponse();
    await login({
      body: { email: "wrong@example.com", password: "somePassword123" },
      requestId: "req-wrong-email"
    }, resWrongEmail, () => {});

    // 2. Wrong password: user exists, wrong password
    User.findOne = () => ({
      select: async () => ({
        _id: "user_1",
        email: "user@example.com",
        passwordHash,
        isActive: true
      })
    });

    const resWrongPass = mockResponse();
    await login({
      body: { email: "user@example.com", password: "wrongPassword123" },
      requestId: "req-wrong-pass"
    }, resWrongPass, () => {});

    assert.equal(resWrongEmail.statusCode, 401);
    assert.equal(resWrongPass.statusCode, 401);
    assert.equal(resWrongEmail.body.code, "UNAUTHENTICATED");
    assert.equal(resWrongPass.body.code, "UNAUTHENTICATED");
    assert.equal(resWrongEmail.body.message, resWrongPass.body.message);
    assert.equal(resWrongEmail.body.message, "Invalid email or password");
  } finally {
    User.findOne = originalFindOne;
  }
});

test("M2: Login with valid credentials establishes session and returns user data", async () => {
  const originalFindOne = User.findOne;
  const passwordHash = await bcrypt.hash("validPassword123", 12);

  User.findOne = () => ({
    select: async () => ({
      _id: "user_valid_1",
      name: "Valid User",
      email: "valid@example.com",
      role: "contributor",
      passwordHash,
      isActive: true,
      emailVerified: true,
      maintainerVerified: false
    })
  });

  try {
    const session = {};
    const req = {
      body: { email: "valid@example.com", password: "validPassword123" },
      session,
      requestId: "req-login"
    };
    const res = mockResponse();

    await login(req, res, () => {});

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(session.userId, "user_valid_1");
    assert.ok(session.csrfToken);
    assert.equal(res.body.data.user.id, "user_valid_1");
    assert.equal(res.body.data.user.passwordHash, undefined);
  } finally {
    User.findOne = originalFindOne;
  }
});

test("M2: Logout destroys session and clears session cookie", async () => {
  let destroyed = false;
  const req = {
    session: {
      userId: "u1",
      destroy: (cb) => { destroyed = true; cb(); }
    },
    requestId: "req-logout"
  };
  const res = mockResponse();

  await logout(req, res, () => {});

  assert.equal(res.statusCode, 200);
  assert.equal(destroyed, true);
  assert.ok(res.cookiesCleared.includes("connect.sid"));
  assert.equal(res.body.success, true);
});

test("M2: Password recovery returns identical response regardless of email presence", async () => {
  const originalFindOne = User.findOne;
  try {
    // Non-existent email
    User.findOne = async () => null;
    const resNonExistent = mockResponse();
    await forgotPassword({
      body: { email: "nonexistent@example.com" },
      requestId: "req-fp-1"
    }, resNonExistent, () => {});

    // Existing email
    let saved = false;
    User.findOne = async () => ({
      save: async () => { saved = true; }
    });
    const resExistent = mockResponse();
    await forgotPassword({
      body: { email: "exists@example.com" },
      requestId: "req-fp-2"
    }, resExistent, () => {});

    assert.equal(resNonExistent.statusCode, 200);
    assert.equal(resExistent.statusCode, 200);
    assert.equal(resNonExistent.body.message, resExistent.body.message);
    assert.equal(saved, true);
  } finally {
    User.findOne = originalFindOne;
  }
});

test("M2: Reset password fails on invalid/expired token and succeeds on valid token", async () => {
  const originalFindOne = User.findOne;
  try {
    // 1. Invalid token
    User.findOne = async () => null;
    const resInvalid = mockResponse();
    await resetPassword({
      body: { token: "invalid_token", password: "newPassword123!" },
      requestId: "req-rp-1"
    }, resInvalid, () => {});

    assert.equal(resInvalid.statusCode, 400);
    assert.equal(resInvalid.body.code, "VALIDATION_ERROR");

    // 2. Valid token
    let updatedHash = null;
    let saved = false;
    User.findOne = async () => ({
      save: async () => { saved = true; },
      set passwordHash(val) { updatedHash = val; }
    });
    const resValid = mockResponse();
    await resetPassword({
      body: { token: "valid_token", password: "newPassword123!" },
      requestId: "req-rp-2"
    }, resValid, () => {});

    assert.equal(resValid.statusCode, 200);
    assert.equal(saved, true);
    assert.ok(updatedHash);
  } finally {
    User.findOne = originalFindOne;
  }
});

test("M2: GET /me returns safe user profile data", async () => {
  const originalFindById = User.findById;
  User.findById = async () => ({
    _id: "user_me_1",
    name: "Ada Lovelace",
    email: "ada@example.com",
    role: "contributor",
    emailVerified: true,
    maintainerVerified: false,
    isActive: true,
    skills: ["javascript", "math"],
    interests: ["algorithms"],
    availability: { hoursPerWeek: 10 }
  });

  try {
    const req = {
      auth: { userId: "user_me_1", role: "contributor" },
      requestId: "req-me"
    };
    const res = mockResponse();
    await me(req, res, () => {});

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.user.name, "Ada Lovelace");
    assert.equal(res.body.data.user.passwordHash, undefined);
  } finally {
    User.findById = originalFindById;
  }
});
