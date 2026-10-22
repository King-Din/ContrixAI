"use strict";

const { test, mock, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { User } = require("../src/models/User");
const { protect, optionalProtect, csrfProtect } = require("../src/middleware/authMiddleware");
const {
  authorize, assertProjectAccess, assertNotPlanOwner, configureAccess,
  assertSnapshotAccess, buildRetrievalScope
} = require("../src/middleware/roleMiddleware");

const U1 = "64b000000000000000000001";
const P_A = "64b0000000000000000000a1";
const P_B = "64b0000000000000000000b2";

afterEach(() => mock.restoreAll());

const stubUser = (doc) =>
  mock.method(User, "findById", () => ({ select: () => ({ lean: async () => doc }) }));
const run = (mw, req) => new Promise((resolve) => mw(req, {}, (e) => resolve(e || null)));
const fail = async (promise) => { try { await promise; } catch (e) { return e; } return null; };

// ---------- protect ----------
test("T04: protect rejects a request with no session", async () => {
  const e = await run(protect, { session: {} });
  assert.equal(e.status, 401);
  assert.equal(e.code, "UNAUTHENTICATED");
});

test("protect rejects a malformed session userId", async () => {
  const e = await run(protect, { session: { userId: "not-an-id" } });
  assert.equal(e.status, 401);
});

test("protect rejects a user that no longer exists", async () => {
  stubUser(null);
  const e = await run(protect, { session: { userId: U1 } });
  assert.equal(e.status, 401);
});

test("protect denies a deactivated user and destroys the session", async () => {
  stubUser({ _id: U1, role: "contributor", isActive: false });
  let destroyed = false;
  const e = await run(protect, { session: { userId: U1, destroy() { destroyed = true; } } });
  assert.equal(e.status, 401);
  assert.equal(destroyed, true);
});

test("protect sets req.auth from the database, not the request body", async () => {
  stubUser({ _id: U1, role: "contributor", name: "A", email: "a@x.com", isActive: true,
    emailVerified: true, maintainerVerified: false });
  const req = { session: { userId: U1 }, body: { role: "moderator", userId: "attacker" } };
  const e = await run(protect, req);
  assert.equal(e, null);
  assert.equal(req.auth.userId, U1);
  assert.equal(req.auth.role, "contributor");
});

// ---------- optionalProtect ----------
test("optionalProtect passes anonymous requests without req.auth", async () => {
  const req = { session: {} };
  assert.equal(await run(optionalProtect, req), null);
  assert.equal(req.auth, undefined);
});

test("optionalProtect sets req.auth for a valid session", async () => {
  stubUser({ _id: U1, role: "contributor", isActive: true });
  const req = { session: { userId: U1 } };
  assert.equal(await run(optionalProtect, req), null);
  assert.equal(req.auth.userId, U1);
});

// ---------- authorize ----------
test("authorize returns 401 when there is no req.auth", async () => {
  const e = await run(authorize("contributor"), {});
  assert.equal(e.status, 401);
});

test("T06: authorize blocks a contributor from a maintainer route", async () => {
  const e = await run(authorize("maintainer"), { auth: { userId: "1", role: "contributor" } });
  assert.equal(e.status, 403);
  assert.equal(e.code, "FORBIDDEN");
});

test("authorize blocks an unverified maintainer", async () => {
  const e = await run(authorize("maintainer"),
    { auth: { userId: "1", role: "maintainer", maintainerVerified: false } });
  assert.equal(e.status, 403);
});

test("authorize allows a verified maintainer", async () => {
  const e = await run(authorize("maintainer"),
    { auth: { userId: "1", role: "maintainer", maintainerVerified: true } });
  assert.equal(e, null);
});

test("authorize does not let a moderator act as a maintainer", async () => {
  const e = await run(authorize("maintainer"), { auth: { userId: "1", role: "moderator" } });
  assert.equal(e.status, 403);
});

test("authorize throws at definition time for an unknown role", () => {
  assert.throws(() => authorize("maintiner"), /unknown role/);
});

// ---------- assertNotPlanOwner ----------
test("T05: assertNotPlanOwner blocks the plan owner, even a maintainer", () => {
  const plan = { contributorId: U1 };
  assert.throws(() => assertNotPlanOwner({ userId: U1, role: "maintainer" }, plan),
    (e) => e.status === 403 && e.code === "FORBIDDEN");
});

test("assertNotPlanOwner allows a different user", () => {
  assert.doesNotThrow(() => assertNotPlanOwner({ userId: "someone-else" }, { contributorId: U1 }));
});

// ---------- assertProjectAccess ----------
const projects = {
  [P_A]: { _id: P_A, visibility: "public", approved: true },
  [P_B]: { _id: P_B, visibility: "private", approved: true }
};
function setupAccess(memberships = {}) {
  configureAccess({
    loadProject: async (id) => projects[id] || null,
    loadMembership: async (userId, projectId) => memberships[`${userId}:${projectId}`] || null
  });
}

test("assertProjectAccess: public project is readable anonymously", async () => {
  setupAccess();
  const r = await assertProjectAccess(null, P_A);
  assert.equal(r.project._id, P_A);
});

test("T07: private project without membership is concealed (404)", async () => {
  setupAccess();
  const e = await fail(assertProjectAccess({ userId: U1, role: "contributor" }, P_B));
  assert.equal(e.status, 404);
});

test("private project with an active membership is readable", async () => {
  setupAccess({ [`${U1}:${P_B}`]: { status: "active", role: "contributor" } });
  const r = await assertProjectAccess({ userId: U1, role: "contributor" }, P_B);
  assert.equal(r.project._id, P_B);
});

test("revoked and invited memberships grant nothing", async () => {
  for (const status of ["revoked", "invited"]) {
    setupAccess({ [`${U1}:${P_B}`]: { status, role: "maintainer" } });
    const e = await fail(assertProjectAccess({ userId: U1, role: "maintainer", maintainerVerified: true }, P_B));
    assert.equal(e.status, 404);
  }
});

test("a contributor asking for maintainer rights gets 403", async () => {
  setupAccess({ [`${U1}:${P_A}`]: { status: "active", role: "contributor" } });
  const e = await fail(assertProjectAccess({ userId: U1, role: "contributor" }, P_A, { minRole: "maintainer" }));
  assert.equal(e.status, 403);
});

test("T07: a maintainer of project A cannot act on project B", async () => {
  setupAccess({ [`${U1}:${P_A}`]: { status: "active", role: "maintainer" } });
  const auth = { userId: U1, role: "maintainer", maintainerVerified: true };
  const e = await fail(assertProjectAccess(auth, P_B, { minRole: "maintainer" }));
  assert.equal(e.status, 404);
});

test("a verified maintainer with an active membership passes", async () => {
  setupAccess({ [`${U1}:${P_A}`]: { status: "active", role: "maintainer" } });
  const auth = { userId: U1, role: "maintainer", maintainerVerified: true };
  const r = await assertProjectAccess(auth, P_A, { minRole: "maintainer" });
  assert.equal(r.project._id, P_A);
});

test("an unverified maintainer is refused maintainer rights", async () => {
  setupAccess({ [`${U1}:${P_A}`]: { status: "active", role: "maintainer" } });
  const auth = { userId: U1, role: "maintainer", maintainerVerified: false };
  const e = await fail(assertProjectAccess(auth, P_A, { minRole: "maintainer" }));
  assert.equal(e.status, 403);
});

test("a malformed project id is a 404", async () => {
  setupAccess();
  const e = await fail(assertProjectAccess(null, "nope"));
  assert.equal(e.status, 404);
});

// ---------- csrfProtect ----------
const csrfReq = (method, sessionToken, headerToken, loggedIn = true) => ({
  method,
  session: loggedIn ? { userId: U1, csrfToken: sessionToken } : {},
  get: (h) => (h.toLowerCase() === "x-csrf-token" ? headerToken : undefined)
});

test("csrfProtect lets safe methods through without a token", async () => {
  assert.equal(await run(csrfProtect, csrfReq("GET", "t", undefined)), null);
});

test("csrfProtect rejects a POST with no header", async () => {
  const e = await run(csrfProtect, csrfReq("POST", "token-1", undefined));
  assert.equal(e.status, 403);
});

test("csrfProtect rejects a mismatched token", async () => {
  const e = await run(csrfProtect, csrfReq("POST", "token-1", "token-2"));
  assert.equal(e.status, 403);
});

test("csrfProtect accepts a matching token", async () => {
  assert.equal(await run(csrfProtect, csrfReq("POST", "token-1", "token-1")), null);
});

test("csrfProtect lets unauthenticated POSTs through (signup, login)", async () => {
  assert.equal(await run(csrfProtect, csrfReq("POST", undefined, undefined, false)), null);
});

// ---------- assertSnapshotAccess / buildRetrievalScope ----------
const S_PUB = "64b0000000000000000000c1";
const S_PRIV = "64b0000000000000000000c2";
const S_OTHER = "64b0000000000000000000c3";
const snapshots = {
  [S_PUB]: { _id: S_PUB, projectId: P_A, visibility: "public", status: "ready" },
  [S_PRIV]: { _id: S_PRIV, projectId: P_A, visibility: "private", status: "ready" },
  [S_OTHER]: { _id: S_OTHER, projectId: P_B, visibility: "public", status: "ready" }
};
function setupSnapshots(memberships = {}) {
  configureAccess({
    loadProject: async (id) => projects[id] || null,
    loadMembership: async (u, p) => memberships[`${u}:${p}`] || null,
    loadSnapshot: async (id) => snapshots[id] || null
  });
}

test("public snapshot of a public project is readable anonymously", async () => {
  setupSnapshots();
  const r = await assertSnapshotAccess(null, S_PUB);
  assert.equal(r.snapshot._id, S_PUB);
});

test("T14: private snapshot is concealed from anonymous users and non-members", async () => {
  setupSnapshots();
  assert.equal((await fail(assertSnapshotAccess(null, S_PRIV))).status, 404);
  assert.equal((await fail(assertSnapshotAccess({ userId: U1, role: "contributor" }, S_PRIV))).status, 404);
});

test("private snapshot is readable by an active member", async () => {
  setupSnapshots({ [`${U1}:${P_A}`]: { status: "active", role: "contributor" } });
  const r = await assertSnapshotAccess({ userId: U1, role: "contributor" }, S_PRIV);
  assert.equal(r.snapshot._id, S_PRIV);
});

test("a snapshot from another project is rejected when projectId is given", async () => {
  setupSnapshots();
  const e = await fail(assertSnapshotAccess(null, S_OTHER, { projectId: P_A }));
  assert.equal(e.status, 404);
});

test("a malformed or unknown snapshot id is a 404", async () => {
  setupSnapshots();
  assert.equal((await fail(assertSnapshotAccess(null, "nope"))).status, 404);
  assert.equal((await fail(assertSnapshotAccess(null, "64b0000000000000000000ff"))).status, 404);
});

test("buildRetrievalScope limits visibility for non-members and widens it for members", async () => {
  setupSnapshots({ [`${U1}:${P_A}`]: { status: "active", role: "contributor" } });
  const anon = await buildRetrievalScope(null, P_A, S_PUB);
  assert.deepEqual(anon.visibility, ["public"]);
  const member = await buildRetrievalScope({ userId: U1, role: "contributor" }, P_A, S_PUB);
  assert.deepEqual(member.visibility, ["public", "private"]);
});