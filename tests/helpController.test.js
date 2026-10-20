"use strict";

const { test, mock } = require("node:test");
const assert = require("node:assert/strict");
const { configureAccess } = require("../src/middleware/roleMiddleware");
const { searchProjectDocuments } = require("../src/controllers/helpController");

const PROJECT_ID = "64b0000000000000000000a1";

function mockResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    }
  };
}

function mockRequest(overrides = {}) {
  return {
    query: { q: "installation", limit: "5" },
    params: { projectId: PROJECT_ID },
    auth: { userId: "64b000000000000000000001", role: "contributor" },
    requestId: "test-request",
    ...overrides
  };
}

test("M8: invalid search query returns a validation error", async () => {
  const req = mockRequest({ query: { q: "" } });
  const res = mockResponse();
  let forwardedError;

  await searchProjectDocuments(req, res, (error) => {
    forwardedError = error;
  });

  assert.equal(forwardedError.status, 400);
  assert.equal(forwardedError.code, "VALIDATION_ERROR");
});

test("M8: accessible project with no retrieval results returns NO_EVIDENCE", async () => {
  configureAccess({
    loadProject: async () => ({ visibility: "public", approved: true }),
    loadMembership: async () => null
  });

  const req = mockRequest();
  const res = mockResponse();
  let forwardedError;

  await searchProjectDocuments(req, res, (error) => {
    forwardedError = error;
  });

  assert.equal(forwardedError, undefined);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.data.results, []);
  assert.equal(res.body.data.outcome, "NO_EVIDENCE");
  assert.equal(res.body.meta.requestId, "test-request");
});

test("M8: inaccessible project errors are forwarded", async () => {
  configureAccess({
    loadProject: async () => null,
    loadMembership: async () => null
  });

  const req = mockRequest();
  const res = mockResponse();
  let forwardedError;

  await searchProjectDocuments(req, res, (error) => {
    forwardedError = error;
  });

  assert.equal(forwardedError.status, 404);
  assert.equal(forwardedError.code, "NOT_FOUND");
});

test("M8: missing query returns a validation error", async () => {
  const req = mockRequest({ query: {} });
  const res = mockResponse();
  let forwardedError;

  await searchProjectDocuments(req, res, (error) => {
    forwardedError = error;
  });

  assert.equal(forwardedError.status, 400);
  assert.equal(forwardedError.code, "VALIDATION_ERROR");
});
