"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const app = require("../src/app");

function withServer(fn) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, async () => {
      const port = server.address().port;
      const baseUrl = `http://localhost:${port}`;
      try {
        await fn(baseUrl);
        server.close(() => resolve());
      } catch (err) {
        server.close(() => reject(err));
      }
    });
  });
}

test("M1: GET /api/health responds with stable health envelope", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/health`);
    const body = await res.json();
    assert.equal(typeof body.success, "boolean");
    assert.ok(body.data);
    assert.ok(body.data.status === "healthy" || body.data.status === "degraded");
    assert.equal(body.data.service, "contrixai-api");
    assert.ok(body.meta && body.meta.requestId);
  });
});

test("M1: GET / responds with API running status", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.name, "ContrixAI API");
    assert.equal(body.data.status, "running");
    assert.ok(body.meta && body.meta.requestId);
  });
});

test("M1: unknown route returns 404 in standard failure JSON envelope", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/unknown-nonexistent-path-12345`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.code, "NOT_FOUND");
    assert.equal(body.message, "The requested endpoint was not found");
    assert.ok(body.requestId);
  });
});

test("M1: malformed JSON returns 400 INVALID_JSON via errorMiddleware", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ not-valid-json "
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.code, "INVALID_JSON");
    assert.equal(body.message, "Request body contains invalid JSON");
    assert.ok(body.requestId);
  });
});

test("M1: disallowed CORS origin returns 403 FORBIDDEN", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: "http://malicious-site.example" }
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.code, "FORBIDDEN");
  });
});
