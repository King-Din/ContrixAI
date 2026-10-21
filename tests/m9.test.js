"use strict";

const { test, mock, before, after, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const session = require("express-session");

const { User } = require("../src/models/User");
const { errorMiddleware } = require("../src/middleware/errorMiddleware");
const { csrfProtect } = require("../src/middleware/authMiddleware");
const requestId = require("../src/middleware/requestId");
const {
  Incident,
  INCIDENT_STATUS,
  INCIDENT_STATUS_TRANSITIONS,
  INCIDENT_SEVERITY,
  INCIDENT_COMPONENTS
} = require("../src/models/Incident");
const {
  getStatus,
  listIncidents,
  createIncident,
  updateIncident,
  computeOverallStatus,
  withTimeout,
  configureStatusChecks,
  runComponentChecks,
  getSnapshotFreshness,
  INCIDENT_WRITE_ROLES
} = require("../src/controllers/statusController");
const statusRoutes = require("../src/routes/statusRoutes");

const U_CONTRIBUTOR = "64b000000000000000000001";
const U_MAINTAINER_VERIFIED = "64b000000000000000000002";
const U_MAINTAINER_UNVERIFIED = "64b000000000000000000003";
const U_MODERATOR = "64b000000000000000000004";

const USERS = {
  [U_CONTRIBUTOR]: { _id: U_CONTRIBUTOR, role: "contributor", isActive: true },
  [U_MAINTAINER_VERIFIED]: { _id: U_MAINTAINER_VERIFIED, role: "maintainer", isActive: true, maintainerVerified: true },
  [U_MAINTAINER_UNVERIFIED]: { _id: U_MAINTAINER_UNVERIFIED, role: "maintainer", isActive: true, maintainerVerified: false },
  [U_MODERATOR]: { _id: U_MODERATOR, role: "moderator", isActive: true }
};

const CSRF_TOKEN = "test-csrf-token-12345";
const INCIDENT_ID_1 = "64b000000000000000000011";
const INCIDENT_ID_2 = "64b000000000000000000012";

let server, baseUrl;
let inMemoryIncidents = [];
const originalEnv = { ...process.env };

before(async () => {
  const app = express();
  app.use(requestId);
  app.use(express.json());
  app.use(
    session({
      secret: "test_secret_m9",
      resave: false,
      saveUninitialized: false
    })
  );

  app.post("/test-login/:id", (req, res) => {
    req.session.userId = req.params.id;
    req.session.csrfToken = CSRF_TOKEN;
    res.json({ ok: true });
  });

  app.use("/api", csrfProtect);
  app.use("/api", statusRoutes);

  app.use((req, res) => {
    res.status(404).json({
      success: false,
      message: "The requested endpoint was not found",
      code: "NOT_FOUND",
      requestId: req.requestId || null
    });
  });

  app.use(errorMiddleware);

  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  if (server && typeof server.closeAllConnections === "function") {
    server.closeAllConnections();
  }
  if (server) {
    server.close();
  }
});

beforeEach(() => {
  process.env = { ...originalEnv };
  inMemoryIncidents = [];

  // Default User mock
  mock.method(User, "findById", (id) => ({
    select: () => ({
      lean: async () => USERS[String(id)] || null
    })
  }));

  // Default Incident mocks
  mock.method(Incident, "find", (query = {}) => {
    let result = [...inMemoryIncidents];
    if (query.status) {
      if (typeof query.status === "object" && query.status.$ne) {
        result = result.filter((i) => i.status !== query.status.$ne);
      } else {
        result = result.filter((i) => i.status === query.status);
      }
    }
    return {
      sort: () => ({
        limit: (lim) => ({
          lean: async () => result.slice(0, lim).map((x) => ({ ...x }))
        })
      })
    };
  });

  mock.method(Incident, "findById", async (id) => {
    const found = inMemoryIncidents.find((i) => String(i._id) === String(id));
    return found ? { ...found } : null;
  });

  mock.method(Incident, "create", async (data) => {
    const doc = {
      _id: "64b000000000000000000099",
      ...data,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    inMemoryIncidents.push(doc);
    return doc;
  });

  mock.method(Incident, "findOneAndUpdate", async (filter, update) => {
    const index = inMemoryIncidents.findIndex(
      (i) => String(i._id) === String(filter._id) && i.status === filter.status
    );
    if (index === -1) return null;
    const current = inMemoryIncidents[index];
    const updated = {
      ...current,
      ...(update.$set || {}),
      updatedAt: new Date()
    };
    inMemoryIncidents[index] = updated;
    return updated;
  });

  // Default checks: healthy
  configureStatusChecks({
    checkApi: async () => ({ status: "healthy", latencyMs: 1 }),
    checkDatabase: async () => ({ status: "healthy", latencyMs: 2 }),
    checkModel: async () => ({ status: "healthy", latencyMs: 5 }),
    checkRetrieval: async () => ({ status: "healthy", latencyMs: 3 }),
    loadLatestSnapshot: async () => ({
      version: "v1",
      visibility: "public",
      status: "ready",
      importedAt: new Date(Date.now() - 24 * 60 * 60 * 1000)
    })
  });
});

afterEach(() => {
  mock.restoreAll();
});

async function loginAs(userId) {
  const res = await fetch(`${baseUrl}/test-login/${userId}`, { method: "POST" });
  return res.headers.get("set-cookie").split(";")[0];
}

function req(path, { method = "GET", cookie = null, csrf = true, body = null } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (csrf && CSRF_TOKEN) headers["x-csrf-token"] = CSRF_TOKEN;
  if (body) headers["content-type"] = "application/json";

  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
}

// ==========================================
// 1. computeOverallStatus pure function test
// ==========================================
test("1. computeOverallStatus: computes healthy, degraded (model/retrieval), unavailable (api/db)", () => {
  const healthy = {
    api: { status: "healthy" },
    database: { status: "healthy" },
    model: { status: "healthy" },
    retrieval: { status: "healthy" }
  };
  assert.equal(computeOverallStatus(healthy), "healthy");

  // Degraded: model unavailable
  const modelDown = {
    api: { status: "healthy" },
    database: { status: "healthy" },
    model: { status: "unavailable" },
    retrieval: { status: "healthy" }
  };
  assert.equal(computeOverallStatus(modelDown), "degraded");

  // Degraded: retrieval unknown
  const retrievalUnknown = {
    api: { status: "healthy" },
    database: { status: "healthy" },
    model: { status: "healthy" },
    retrieval: { status: "unknown" }
  };
  assert.equal(computeOverallStatus(retrievalUnknown), "degraded");

  // Unavailable: database unavailable
  const dbDown = {
    api: { status: "healthy" },
    database: { status: "unavailable" },
    model: { status: "healthy" },
    retrieval: { status: "healthy" }
  };
  assert.equal(computeOverallStatus(dbDown), "unavailable");

  // Unavailable: api unavailable
  const apiDown = {
    api: { status: "unavailable" },
    database: { status: "healthy" },
    model: { status: "healthy" },
    retrieval: { status: "healthy" }
  };
  assert.equal(computeOverallStatus(apiDown), "unavailable");
});

// ==========================================
// 2. Blueprint T19: Model-down responds degraded with envelope and safe fields
// ==========================================
test("2. T19: Model-down responds degraded with envelope, safe fields, and no error leakage", async () => {
  configureStatusChecks({
    checkModel: async () => ({ status: "unavailable", latencyMs: 15 })
  });

  const res = await req("/api/status");
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.equal(body.success, true);
  assert.equal(body.data.status, "degraded");
  assert.equal(body.data.service, "contrixai-api");
  assert.equal(body.data.components.model.status, "unavailable");
  assert.equal(typeof body.data.components.model.latencyMs, "number");
  assert.equal(body.data.components.database.status, "healthy");
  assert.ok(body.meta && body.meta.requestId);
  assert.equal(body.meta.snapshotVersion, "v1");

  const rawJson = JSON.stringify(body);
  assert.equal(rawJson.includes("stack"), false);
  assert.equal(rawJson.includes("ECONNREFUSED"), false);
});

// ==========================================
// 3. Hanging check cut off at timeout and endpoint still responds
// ==========================================
test("3. Hanging check is cut off at timeout and endpoint still returns", async () => {
  process.env.STATUS_CHECK_TIMEOUT_MS = "50";

  configureStatusChecks({
    checkModel: async (signal, timeoutMs) => {
      return await withTimeout(
        () => new Promise(() => {}), // never resolves
        timeoutMs || 50
      );
    }
  });

  const start = Date.now();
  const res = await req("/api/status");
  const duration = Date.now() - start;

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.data.status, "degraded");
  assert.equal(body.data.components.model.status, "unavailable");
  assert.ok(duration < 500, `Expected duration under 500ms, was ${duration}ms`);
});

// ==========================================
// 4. Client-supplied computed status ignored on GET/POST/PATCH
// ==========================================
test("4. Client-supplied computed status ignored on GET /status, rejected on POST/PATCH", async () => {
  configureStatusChecks({
    checkDatabase: async () => ({ status: "unavailable", latencyMs: 5 })
  });

  // Client query ?status=healthy must be ignored
  const res = await req("/api/status?status=healthy");
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.data.status, "unavailable");
  assert.equal(body.success, false);

  // POST with client-supplied status or overall rejected 400
  const maintainerCookie = await loginAs(U_MAINTAINER_VERIFIED);
  const postRes = await req("/api/incidents", {
    method: "POST",
    cookie: maintainerCookie,
    body: {
      title: "API Outage",
      severity: "major",
      component: "api",
      status: "resolved",
      overall: "healthy"
    }
  });
  assert.equal(postRes.status, 400);
  const postBody = await postRes.json();
  assert.equal(postBody.code, "VALIDATION_ERROR");

  // PATCH with client-supplied overall rejected 400
  inMemoryIncidents = [
    {
      _id: INCIDENT_ID_1,
      title: "Active Outage",
      severity: "major",
      component: "api",
      status: "investigating",
      createdBy: U_MAINTAINER_VERIFIED
    }
  ];

  const patchRes = await req(`/api/incidents/${INCIDENT_ID_1}`, {
    method: "PATCH",
    cookie: maintainerCookie,
    body: {
      status: "identified",
      overall: "healthy"
    }
  });
  assert.equal(patchRes.status, 400);
  const patchBody = await patchRes.json();
  assert.equal(patchBody.code, "VALIDATION_ERROR");
});

// ==========================================
// 5. Secret leakage prevention
// ==========================================
test("5. Secret leakage: URL, credentials, host, and stack traces are never exposed", async () => {
  const secretHost = "super-secret-internal.corp.network";
  const secretPass = "SuperSecretPassword123!";
  process.env.OLLAMA_BASE_URL = `http://admin:${secretPass}@${secretHost}:11434`;

  // Restore default model checker to test real env URL handling
  configureStatusChecks({
    checkModel: null
  });

  const res = await req("/api/status");
  const rawText = await res.text();

  assert.equal(rawText.includes(secretHost), false);
  assert.equal(rawText.includes(secretPass), false);
  assert.equal(rawText.includes("11434"), false);
  assert.equal(rawText.includes("stack"), false);
});

// ==========================================
// 6. Incident transitions: invalid, same-state, concurrent, and valid
// ==========================================
test("6. Incident transitions: resolved->investigating (409), same-state (409), concurrent (409), valid (200)", async () => {
  const maintainerCookie = await loginAs(U_MAINTAINER_VERIFIED);

  // A. resolved -> investigating returns 409 CONFLICT
  inMemoryIncidents = [
    {
      _id: INCIDENT_ID_1,
      title: "Resolved incident",
      severity: "minor",
      component: "model",
      status: "resolved",
      createdBy: U_MAINTAINER_VERIFIED
    }
  ];

  const resA = await req(`/api/incidents/${INCIDENT_ID_1}`, {
    method: "PATCH",
    cookie: maintainerCookie,
    body: { status: "investigating" }
  });
  assert.equal(resA.status, 409);
  assert.equal((await resA.json()).code, "CONFLICT");

  // B. same-state (investigating -> investigating) returns 409 CONFLICT
  inMemoryIncidents = [
    {
      _id: INCIDENT_ID_1,
      title: "Investigating incident",
      severity: "minor",
      component: "model",
      status: "investigating",
      createdBy: U_MAINTAINER_VERIFIED
    }
  ];

  const resB = await req(`/api/incidents/${INCIDENT_ID_1}`, {
    method: "PATCH",
    cookie: maintainerCookie,
    body: { status: "investigating" }
  });
  assert.equal(resB.status, 409);
  assert.equal((await resB.json()).code, "CONFLICT");

  // C. Concurrent change (findOneAndUpdate returns null) returns 409 CONFLICT
  mock.method(Incident, "findOneAndUpdate", async () => null);

  const resC = await req(`/api/incidents/${INCIDENT_ID_1}`, {
    method: "PATCH",
    cookie: maintainerCookie,
    body: { status: "identified" }
  });
  assert.equal(resC.status, 409);
  assert.equal((await resC.json()).code, "CONFLICT");

  // D. Valid transition: investigating -> resolved sets resolvedAt and returns 200
  mock.method(Incident, "findOneAndUpdate", async (filter, update) => {
    return {
      _id: INCIDENT_ID_1,
      title: "Investigating incident",
      severity: "minor",
      component: "model",
      status: update.$set.status,
      resolvedAt: update.$set.resolvedAt,
      createdBy: U_MAINTAINER_VERIFIED,
      createdAt: new Date(),
      updatedAt: new Date()
    };
  });

  const resD = await req(`/api/incidents/${INCIDENT_ID_1}`, {
    method: "PATCH",
    cookie: maintainerCookie,
    body: { status: "resolved" }
  });
  assert.equal(resD.status, 200);
  const bodyD = await resD.json();
  assert.equal(bodyD.success, true);
  assert.equal(bodyD.data.incident.status, "resolved");
  assert.ok(bodyD.data.incident.resolvedAt);
});

// ==========================================
// 7. createdBy strictly derived from session identity
// ==========================================
test("7. createdBy derived from session: body-supplied createdBy rejected, created doc uses req.auth.userId", async () => {
  const maintainerCookie = await loginAs(U_MAINTAINER_VERIFIED);

  // Body with createdBy rejected by Zod .strict()
  const resBad = await req("/api/incidents", {
    method: "POST",
    cookie: maintainerCookie,
    body: {
      title: "Database latency spike",
      severity: "major",
      component: "database",
      createdBy: "attacker"
    }
  });
  assert.equal(resBad.status, 400);
  assert.equal((await resBad.json()).code, "VALIDATION_ERROR");

  // Valid body creates incident with session's userId
  let createdPayload = null;
  mock.method(Incident, "create", async (data) => {
    createdPayload = data;
    return {
      _id: INCIDENT_ID_1,
      ...data,
      createdAt: new Date(),
      updatedAt: new Date()
    };
  });

  const resGood = await req("/api/incidents", {
    method: "POST",
    cookie: maintainerCookie,
    body: {
      title: "Database latency spike",
      severity: "major",
      component: "database"
    }
  });
  assert.equal(resGood.status, 201);
  assert.ok(createdPayload);
  assert.equal(createdPayload.createdBy, U_MAINTAINER_VERIFIED);
  assert.equal(createdPayload.status, "investigating");
});

// ==========================================
// 8. Authorization: anonymous 401, contributor 403, unverified 403, verified 201, moderator 201, CSRF 403, malformed id 404
// ==========================================
test("8. Authorization guards and edge cases", async () => {
  const validBody = {
    title: "Gateway timeout",
    severity: "critical",
    component: "api"
  };

  // Anonymous POST -> 401 UNAUTHENTICATED
  const resAnon = await req("/api/incidents", {
    method: "POST",
    body: validBody
  });
  assert.equal(resAnon.status, 401);
  assert.equal((await resAnon.json()).code, "UNAUTHENTICATED");

  // Contributor POST -> 403 FORBIDDEN
  const contributorCookie = await loginAs(U_CONTRIBUTOR);
  const resContrib = await req("/api/incidents", {
    method: "POST",
    cookie: contributorCookie,
    body: validBody
  });
  assert.equal(resContrib.status, 403);
  assert.equal((await resContrib.json()).code, "FORBIDDEN");

  // Unverified maintainer POST -> 403 FORBIDDEN
  const unverifiedCookie = await loginAs(U_MAINTAINER_UNVERIFIED);
  const resUnverified = await req("/api/incidents", {
    method: "POST",
    cookie: unverifiedCookie,
    body: validBody
  });
  assert.equal(resUnverified.status, 403);
  assert.equal((await resUnverified.json()).code, "FORBIDDEN");

  // Verified maintainer POST -> 201
  const verifiedCookie = await loginAs(U_MAINTAINER_VERIFIED);
  const resVerified = await req("/api/incidents", {
    method: "POST",
    cookie: verifiedCookie,
    body: validBody
  });
  assert.equal(resVerified.status, 201);

  // Moderator POST -> 201
  const moderatorCookie = await loginAs(U_MODERATOR);
  const resMod = await req("/api/incidents", {
    method: "POST",
    cookie: moderatorCookie,
    body: validBody
  });
  assert.equal(resMod.status, 201);

  // POST without CSRF token -> 403 FORBIDDEN
  const resNoCsrf = await req("/api/incidents", {
    method: "POST",
    cookie: verifiedCookie,
    csrf: false,
    body: validBody
  });
  assert.equal(resNoCsrf.status, 403);
  assert.equal((await resNoCsrf.json()).code, "FORBIDDEN");

  // Malformed ObjectId in PATCH -> 404 NOT_FOUND
  const resMalformed = await req("/api/incidents/not-a-valid-object-id", {
    method: "PATCH",
    cookie: verifiedCookie,
    body: { status: "identified" }
  });
  assert.equal(resMalformed.status, 404);
  assert.equal((await resMalformed.json()).code, "NOT_FOUND");
});

// ==========================================
// 9. Public GET /incidents hides createdBy and caps limit
// ==========================================
test("9. Public GET /incidents hides createdBy for public callers, reveals to maintainers, and caps limit", async () => {
  inMemoryIncidents = [
    {
      _id: INCIDENT_ID_1,
      title: "Index building",
      severity: "minor",
      component: "retrieval",
      status: "investigating",
      createdBy: U_MAINTAINER_VERIFIED,
      createdAt: new Date(),
      updatedAt: new Date()
    }
  ];

  // Anonymous caller: createdBy is hidden
  const resAnon = await req("/api/incidents");
  assert.equal(resAnon.status, 200);
  const bodyAnon = await resAnon.json();
  assert.equal(bodyAnon.data.incidents.length, 1);
  assert.equal(bodyAnon.data.incidents[0].createdBy, undefined);

  // Contributor caller: createdBy is hidden
  const contribCookie = await loginAs(U_CONTRIBUTOR);
  const resContrib = await req("/api/incidents", { cookie: contribCookie });
  assert.equal(resContrib.status, 200);
  const bodyContrib = await resContrib.json();
  assert.equal(bodyContrib.data.incidents[0].createdBy, undefined);

  // Verified maintainer caller: createdBy is revealed
  const maintainerCookie = await loginAs(U_MAINTAINER_VERIFIED);
  const resMaint = await req("/api/incidents", { cookie: maintainerCookie });
  assert.equal(resMaint.status, 200);
  const bodyMaint = await resMaint.json();
  assert.equal(bodyMaint.data.incidents[0].createdBy, U_MAINTAINER_VERIFIED);

  // Limit capping: requesting limit=100 caps to 50
  let capturedLimit = null;
  mock.method(Incident, "find", () => ({
    sort: () => ({
      limit: (l) => {
        capturedLimit = l;
        return { lean: async () => [] };
      }
    })
  }));

  await req("/api/incidents?limit=100");
  assert.equal(capturedLimit, 50);
});

// ==========================================
// 10. Freshness logic: 8-day-old, 1-day-old, missing, and private/failed
// ==========================================
test("10. Snapshot freshness: 8-day stale true, 1-day stale false, missing null, private/failed concealed", async () => {
  // A. 8 days old -> stale: true
  configureStatusChecks({
    loadLatestSnapshot: async () => ({
      version: "v2",
      visibility: "public",
      status: "ready",
      importedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
    })
  });
  const freshnessA = await getSnapshotFreshness();
  assert.equal(freshnessA.version, "v2");
  assert.equal(freshnessA.stale, true);

  // B. 1 day old -> stale: false
  configureStatusChecks({
    loadLatestSnapshot: async () => ({
      version: "v3",
      visibility: "public",
      status: "ready",
      importedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000)
    })
  });
  const freshnessB = await getSnapshotFreshness();
  assert.equal(freshnessB.version, "v3");
  assert.equal(freshnessB.stale, false);

  // C. No snapshot -> nulls
  configureStatusChecks({
    loadLatestSnapshot: async () => null
  });
  const freshnessC = await getSnapshotFreshness();
  assert.deepEqual(freshnessC, { version: null, importedAt: null, stale: null });

  // D. Private snapshot concealed
  configureStatusChecks({
    loadLatestSnapshot: async () => ({
      version: "secret-v1",
      visibility: "private",
      status: "ready",
      importedAt: new Date()
    })
  });
  const freshnessD = await getSnapshotFreshness();
  assert.deepEqual(freshnessD, { version: null, importedAt: null, stale: null });

  // E. Failed snapshot concealed
  configureStatusChecks({
    loadLatestSnapshot: async () => ({
      version: "failed-v1",
      visibility: "public",
      status: "failed",
      importedAt: new Date()
    })
  });
  const freshnessE = await getSnapshotFreshness();
  assert.deepEqual(freshnessE, { version: null, importedAt: null, stale: null });
});
