"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  requireAuth,
  requireRole,
  requireProjectAccess,
  requireCsrf,
  requireVerifiedEmail,
  requireVerifiedMaintainer
} = require("./authGuards");

function request(overrides = {}) {
  return {
    params: { projectId: "project-123" },
    app: { locals: {} },
    ...overrides
  };
}

function invoke(middleware, req) {
  return new Promise((resolve) => {
    middleware(req, {}, (error) => resolve(error || null));
  });
}

test("requireAuth rejects requests without authenticated context", async () => {
  const error = await invoke(requireAuth, request());
  assert.equal(error.status, 401);
  assert.equal(error.code, "UNAUTHENTICATED");
});

test("requireAuth accepts authenticated context", async () => {
  const error = await invoke(requireAuth, request({ auth: { userId: "u1", role: "contributor" } }));
  assert.equal(error, null);
});

test("requireRole rejects disallowed role and accepts allowed role", async () => {
  const denied = await invoke(requireRole("moderator"), request({ auth: { userId: "u1", role: "contributor" } }));
  assert.equal(denied.status, 403);
  const allowed = await invoke(requireRole("contributor", "maintainer"), request({ auth: { userId: "u1", role: "contributor" } }));
  assert.equal(allowed, null);
});

test("project access guard fails closed if checker is not configured", async () => {
  const error = await invoke(requireProjectAccess(), request({ auth: { userId: "u1", role: "contributor" } }));
  assert.equal(error.status, 500);
});

test("project access guard calls checker using authenticated identity, not body identity", async () => {
  let received;
  const req = request({
    body: { userId: "attacker", role: "moderator" },
    auth: { userId: "real-user", role: "contributor" },
    app: { locals: { checkProjectAccess: async (input) => { received = input; return true; } } }
  });
  const error = await invoke(requireProjectAccess({ roles: ["member"] }), req);
  assert.equal(error, null);
  assert.equal(received.userId, "real-user");
  assert.equal(received.projectId, "project-123");
  assert.equal(received.userRole, "contributor");
  assert.deepEqual(req.projectAccess, { projectId: "project-123" });
});

test("project access guard rejects membership failures", async () => {
  const req = request({
    auth: { userId: "u1", role: "contributor" },
    app: { locals: { checkProjectAccess: async () => false } }
  });
  const error = await invoke(requireProjectAccess(), req);
  assert.equal(error.status, 403);
});

test("verified-email guard rejects unverified users", async () => {
  const error = await invoke(requireVerifiedEmail, request({ auth: { userId: "u1", emailVerified: false } }));
  assert.equal(error.status, 403);
});

test("verified-maintainer guard requires role and verification flag", async () => {
  const denied = await invoke(requireVerifiedMaintainer, request({ auth: { userId: "u1", role: "maintainer", maintainerVerified: false } }));
  assert.equal(denied.status, 403);
  const allowed = await invoke(requireVerifiedMaintainer, request({ auth: { userId: "u1", role: "maintainer", maintainerVerified: true } }));
  assert.equal(allowed, null);
});


test("CSRF guard accepts safe methods without a token", async () => {
  const error = await invoke(requireCsrf, request({ method: "GET" }));
  assert.equal(error, null);
});

test("CSRF guard rejects unsafe requests without a matching token", async () => {
  const missing = await invoke(requireCsrf, request({ method: "POST", session: { csrfToken: "token-1" }, headers: {} }));
  assert.equal(missing.status, 403);
  const mismatched = await invoke(requireCsrf, request({ method: "POST", session: { csrfToken: "token-1" }, headers: { "x-csrf-token": "token-2" } }));
  assert.equal(mismatched.status, 403);
  const valid = await invoke(requireCsrf, request({ method: "POST", session: { csrfToken: "token-1" }, headers: { "x-csrf-token": "token-1" } }));
  assert.equal(valid, null);
});
