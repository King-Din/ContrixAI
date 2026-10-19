"use strict";

const { test, mock, before, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const session = require("express-session");
const { User } = require("../src/models/User");
const { errorMiddleware } = require("../src/middleware/errorMiddleware");
const { protect, csrfProtect } = require("../src/middleware/authMiddleware");
const { authorize, assertProjectAccess, assertNotPlanOwner, configureAccess } =
  require("../src/middleware/roleMiddleware");

const U1 = "64b000000000000000000001"; // contributor
const U2 = "64b000000000000000000002"; // verified maintainer of project A
const P_A = "64b0000000000000000000a1";
const P_B = "64b0000000000000000000b2";
const USERS = {
  [U1]: { _id: U1, role: "contributor", isActive: true },
  [U2]: { _id: U2, role: "maintainer", isActive: true, maintainerVerified: true }
};
const PLANS = {
  p1: { contributorId: U1, projectId: P_A },   // someone else's plan, project A
  p2: { contributorId: U2, projectId: P_A },   // the maintainer's own plan
  p3: { contributorId: U1, projectId: P_B }    // plan in a project U2 is not part of
};
const CSRF = "csrf-token-1";

let server, base;

before(async () => {
  mock.method(User, "findById", (id) => ({ select: () => ({ lean: async () => USERS[String(id)] || null }) }));
  configureAccess({
    loadProject: async (id) =>
      ({ [P_A]: { visibility: "public", approved: true }, [P_B]: { visibility: "private", approved: true } })[id] || null,
    loadMembership: async (userId, projectId) =>
      userId === U2 && projectId === P_A ? { status: "active", role: "maintainer" } : null
  });

  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.post("/test-login/:id", (req, res) => {
    req.session.userId = req.params.id;
    req.session.csrfToken = CSRF;
    res.json({ ok: true });
  });
  app.use(csrfProtect);
  app.get("/me", protect, (req, res) => res.json({ userId: req.auth.userId }));
  app.post("/imports", protect, authorize("maintainer"), (req, res) => res.json({ ok: true }));
  app.post("/plans/:id/review", protect, authorize("maintainer"), async (req, res, next) => {
    try {
      const plan = PLANS[req.params.id];
      if (!plan) return res.status(404).json({ code: "NOT_FOUND" });
      await assertProjectAccess(req.auth, plan.projectId, { minRole: "maintainer" });
      assertNotPlanOwner(req.auth, plan);
      return res.json({ ok: true });
    } catch (e) { return next(e); }
  });
  app.use(errorMiddleware);

  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => { server.closeAllConnections?.(); server.close(); });

async function loginAs(id) {
  const res = await fetch(`${base}/test-login/${id}`, { method: "POST" });
  return res.headers.get("set-cookie").split(";")[0];
}
const post = (path, cookie, { csrf = true, body } = {}) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json", ...(csrf ? { "x-csrf-token": CSRF } : {}) },
    body: JSON.stringify(body || {})
  });

test("T04: request with no session gets 401 UNAUTHENTICATED", async () => {
  const res = await fetch(`${base}/me`);
  assert.equal(res.status, 401);
  assert.equal((await res.json()).code, "UNAUTHENTICATED");
});

test("a logged-in user can read /me", async () => {
  const cookie = await loginAs(U1);
  const res = await fetch(`${base}/me`, { headers: { cookie } });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).userId, U1);
});

test("T06: contributor cannot call a maintainer route, even with a spoofed role in the body", async () => {
  const cookie = await loginAs(U1);
  const res = await post("/imports", cookie, { body: { role: "maintainer" } });
  assert.equal(res.status, 403);
});

test("CSRF: maintainer POST without the token is 403, with it is 200", async () => {
  const cookie = await loginAs(U2);
  assert.equal((await post("/imports", cookie, { csrf: false })).status, 403);
  assert.equal((await post("/imports", cookie)).status, 200);
});

test("maintainer can review another contributor's plan in their own project", async () => {
  const cookie = await loginAs(U2);
  assert.equal((await post("/plans/p1/review", cookie)).status, 200);
});

test("T05: maintainer cannot review their own plan", async () => {
  const cookie = await loginAs(U2);
  assert.equal((await post("/plans/p2/review", cookie)).status, 403);
});

test("T07: maintainer cannot review a plan in a project they do not belong to", async () => {
  const cookie = await loginAs(U2);
  assert.equal((await post("/plans/p3/review", cookie)).status, 404);
});