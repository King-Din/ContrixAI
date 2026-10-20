"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const roleMiddleware = require("../src/middleware/roleMiddleware");
const { searchProjectDocuments } = require("../src/controllers/helpController");

const validProjectId = "507f1f77bcf86cd799439011";

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
    params: { projectId: validProjectId },
    auth: { userId: "user-123", role: "contributor" },
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

  assert.ok(forwardedError);
  assert.equal(forwardedError.status, 400);
  assert.equal(forwardedError.code, "VALIDATION_ERROR");
});

test("M8: project access is checked before returning results", async () => {
  const original = roleMiddleware.assertProjectAccess;
  let accessChecked = false;

  roleMiddleware.assertProjectAccess = async (auth, projectId) => {
    accessChecked = true;
    assert.equal(auth.userId, "user-123");
    assert.equal(projectId, validProjectId);
  };

  try {
    const req = mockRequest();
    const res = mockResponse();
    let forwardedError;

    await searchProjectDocuments(req, res, (error) => {
      forwardedError = error;
    });

    assert.equal(accessChecked, true);
    assert.equal(forwardedError, undefined);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.data.results, []);
    assert.equal(res.body.data.outcome, "NO_EVIDENCE");
  } finally {
    roleMiddleware.assertProjectAccess = original;
  }
});

test("M8: project access errors are forwarded to error middleware", async () => {
  const original = roleMiddleware.assertProjectAccess;

  roleMiddleware.assertProjectAccess = async () => {
    throw Object.assign(new Error("Not found"), {
      status: 404,
      code: "NOT_FOUND"
    });
  };

  try {
    const req = mockRequest();
    const res = mockResponse();
    let forwardedError;

    await searchProjectDocuments(req, res, (error) => {
      forwardedError = error;
    });

    assert.equal(forwardedError.status, 404);
    assert.equal(forwardedError.code, "NOT_FOUND");
  } finally {
    roleMiddleware.assertProjectAccess = original;
  }
});

test("M8: missing search query returns a validation error", async () => {
  const req = mockRequest({ query: {} });
  const res = mockResponse();
  let forwardedError;

  await searchProjectDocuments(req, res, (error) => {
    forwardedError = error;
  });

  assert.equal(forwardedError.status, 400);
  assert.equal(forwardedError.code, "VALIDATION_ERROR");
});
