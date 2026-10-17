"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { errorMiddleware, normalizeError } = require("../src/middleware/errorMiddleware");

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test("maps malformed JSON to INVALID_JSON", () => {
  const err = new SyntaxError("parser detail");
  err.status = 400;
  err.body = "{";
  assert.deepEqual(normalizeError(err), { status: 400, code: "INVALID_JSON", message: "Request body contains invalid JSON" });
});

test("maps duplicate keys to CONFLICT", () => {
  assert.equal(normalizeError({ code: 11000 }).code, "CONFLICT");
});

test("maps auth and authorization errors", () => {
  assert.equal(normalizeError({ status: 401 }).code, "UNAUTHENTICATED");
  assert.equal(normalizeError({ status: 403 }).code, "FORBIDDEN");
  assert.equal(normalizeError({ status: 404 }).code, "NOT_FOUND");
});

test("maps rate limits and AI outages", () => {
  assert.equal(normalizeError({ status: 429 }).code, "RATE_LIMITED");
  assert.equal(normalizeError({ code: "ECONNREFUSED" }).code, "AI_UNAVAILABLE");
});

test("never returns stack traces or internal error messages", () => {
  const res = response();
  const err = new Error("mongodb://secret-host/private-db");
  err.stack = "SECRET STACK TRACE";
  errorMiddleware(err, { requestId: "req-1" }, res, () => {});
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.message, "An unexpected server error occurred");
  assert.equal(JSON.stringify(res.body).includes("SECRET"), false);
  assert.equal(JSON.stringify(res.body).includes("secret-host"), false);
});

test("error response includes stable requestId and code", () => {
  const res = response();
  errorMiddleware({ status: 404 }, { requestId: "req-2" }, res, () => {});
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.code, "NOT_FOUND");
  assert.equal(res.body.requestId, "req-2");
  assert.equal(res.body.success, false);
});
