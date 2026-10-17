"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { Plan } = require("../src/models/Plan");
const { ENTITLEMENT_STATUS, isEntitlementActive } = require("../src/models/Entitlement");
const {
  createPlan,
  getPlan,
  updatePlan,
  reviewPlan
} = require("../src/controllers/planController");

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

test("M6: Entitlement model documents deferred billing status", () => {
  assert.equal(ENTITLEMENT_STATUS.DEFERRED, "deferred");
  assert.equal(isEntitlementActive(), false);
});

test("M6: POST /api/contribution-plans rejects unauthenticated callers", async () => {
  const req = { auth: null };
  const res = mockResponse();
  await createPlan(req, res, () => {});
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, "UNAUTHENTICATED");
});

test("M6: POST /api/contribution-plans creates a draft plan with session identity", async () => {
  const originalCreate = Plan.create;
  let createdDoc = null;

  Plan.create = async (payload) => {
    createdDoc = payload;
    return { _id: new mongoose.Types.ObjectId(), ...payload };
  };

  try {
    const req = {
      auth: { userId: "507f1f77bcf86cd799439011", role: "contributor" },
      body: {
        contributorId: "attacker_spoofed_id",
        status: "approved", // Attacker trying to bypass review
        projectId: "project-1",
        issueId: "issue-101",
        approach: "This is a detailed valid approach description for fixing the issue.",
        steps: [
          { order: 1, title: "Step 1", detail: "Read documentation" }
        ],
        evidenceRefs: [
          { chunkId: "c1", snapshotId: "snap-1", path: "README.md", heading: "Setup" }
        ]
      },
      requestId: "req-create-plan"
    };
    const res = mockResponse();

    await createPlan(req, res, () => {});

    assert.equal(res.statusCode, 201);
    assert.equal(createdDoc.contributorId, "507f1f77bcf86cd799439011");
    assert.equal(createdDoc.status, "draft");
    assert.equal(res.body.success, true);
  } finally {
    Plan.create = originalCreate;
  }
});

test("M6: T10 - Plans reject evidenceRefs pointing outside the plan's snapshot", async () => {
  const req = {
    auth: { userId: "507f1f77bcf86cd799439011", role: "contributor" },
    body: {
      projectId: "project-1",
      issueId: "issue-101",
      approach: "This is a valid approach description with conflicting snapshot evidence.",
      steps: [{ order: 1, title: "Step 1", detail: "Investigate" }],
      snapshotId: "snap-authorized-v1",
      evidenceRefs: [
        { chunkId: "c1", snapshotId: "snap-authorized-v1", path: "README.md" },
        { chunkId: "c2", snapshotId: "snap-OTHER-UNAUTHORIZED-v2", path: "INTERNAL.md" }
      ]
    },
    requestId: "req-t10"
  };
  const res = mockResponse();

  await createPlan(req, res, () => {});

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, "VALIDATION_ERROR");
  assert.equal(res.body.message.includes("Evidence references must belong"), true);
});

test("M6: T08 - Contributor B reading Contributor A's plan is denied/concealed", async () => {
  const originalFindById = Plan.findById;
  const planId = new mongoose.Types.ObjectId();

  Plan.findById = async () => ({
    _id: planId,
    contributorId: new mongoose.Types.ObjectId("507f1f77bcf86cd799439011"),
    projectId: "project-1",
    status: "draft"
  });

  try {
    // Contributor B calls GET
    const reqB = {
      auth: { userId: "507f1f77bcf86cd799439099", role: "contributor" }, // Different user
      params: { id: String(planId) },
      requestId: "req-t08"
    };
    const resB = mockResponse();
    await getPlan(reqB, resB, () => {});

    assert.equal(resB.statusCode, 404);
    assert.equal(resB.body.code, "NOT_FOUND");

    // Maintainer calls GET -> allowed
    const reqM = {
      auth: { userId: "507f1f77bcf86cd799439088", role: "maintainer" },
      params: { id: String(planId) },
      requestId: "req-t08-m"
    };
    const resM = mockResponse();
    await getPlan(reqM, resM, () => {});

    assert.equal(resM.statusCode, 200);
    assert.equal(resM.body.success, true);
  } finally {
    Plan.findById = originalFindById;
  }
});

test("M6: T09 - When a submitted plan is edited, return 409 CONFLICT", async () => {
  const originalFindById = Plan.findById;
  const planId = new mongoose.Types.ObjectId();
  const userId = "507f1f77bcf86cd799439011";

  Plan.findById = async () => ({
    _id: planId,
    contributorId: new mongoose.Types.ObjectId(userId),
    projectId: "project-1",
    status: "submitted", // already submitted!
    save: async () => {}
  });

  try {
    const req = {
      auth: { userId, role: "contributor" },
      params: { id: String(planId) },
      body: {
        approach: "Trying to edit an already submitted contribution plan."
      },
      requestId: "req-t09"
    };
    const res = mockResponse();

    await updatePlan(req, res, () => {});

    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, "CONFLICT");
  } finally {
    Plan.findById = originalFindById;
  }
});

test("M6: Contributor can submit their own draft plan", async () => {
  const originalFindById = Plan.findById;
  const planId = new mongoose.Types.ObjectId();
  const userId = "507f1f77bcf86cd799439011";

  let saved = false;
  const mockPlan = {
    _id: planId,
    contributorId: new mongoose.Types.ObjectId(userId),
    projectId: "project-1",
    status: "draft",
    statusHistory: [],
    save: async () => { saved = true; }
  };
  Plan.findById = async () => mockPlan;

  try {
    const req = {
      auth: { userId, role: "contributor" },
      params: { id: String(planId) },
      body: {
        status: "submitted"
      },
      requestId: "req-submit"
    };
    const res = mockResponse();

    await updatePlan(req, res, () => {});

    assert.equal(res.statusCode, 200);
    assert.equal(saved, true);
    assert.equal(mockPlan.status, "submitted");
    assert.ok(mockPlan.submittedAt);
  } finally {
    Plan.findById = originalFindById;
  }
});

test("M6: T05 - Contributor reviewing their own plan returns 403 FORBIDDEN", async () => {
  const originalFindById = Plan.findById;
  const planId = new mongoose.Types.ObjectId();
  const userId = "507f1f77bcf86cd799439011";

  // Plan owned by this user
  Plan.findById = async () => ({
    _id: planId,
    contributorId: new mongoose.Types.ObjectId(userId),
    status: "submitted"
  });

  try {
    const req = {
      auth: { userId, role: "maintainer" }, // User is maintainer, but also owns the plan!
      params: { id: String(planId) },
      body: {
        decision: "approved",
        feedback: "Self approval attempt"
      },
      requestId: "req-t05"
    };
    const res = mockResponse();

    await reviewPlan(req, res, () => {});

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, "FORBIDDEN");
    assert.equal(res.body.message.includes("cannot review their own"), true);
  } finally {
    Plan.findById = originalFindById;
  }
});

test("M6: Maintainer can review another user's submitted plan", async () => {
  const originalFindById = Plan.findById;
  const planId = new mongoose.Types.ObjectId();
  const ownerId = "507f1f77bcf86cd799439011";
  const maintainerId = "507f1f77bcf86cd799439088";

  let saved = false;
  const mockPlan = {
    _id: planId,
    contributorId: new mongoose.Types.ObjectId(ownerId),
    status: "submitted",
    statusHistory: [],
    save: async () => { saved = true; }
  };
  Plan.findById = async () => mockPlan;

  try {
    const req = {
      auth: { userId: maintainerId, role: "maintainer" },
      params: { id: String(planId) },
      body: {
        decision: "approved",
        feedback: "Excellent plan. Approved to begin work."
      },
      requestId: "req-review-ok"
    };
    const res = mockResponse();

    await reviewPlan(req, res, () => {});

    assert.equal(res.statusCode, 200);
    assert.equal(saved, true);
    assert.equal(mockPlan.status, "approved");
    assert.equal(mockPlan.reviewerId, maintainerId);
    assert.equal(mockPlan.feedback, "Excellent plan. Approved to begin work.");
    assert.ok(mockPlan.reviewedAt);
  } finally {
    Plan.findById = originalFindById;
  }
});

test("M6: Reviewing a plan that is not in submitted status returns 409 CONFLICT", async () => {
  const originalFindById = Plan.findById;
  const planId = new mongoose.Types.ObjectId();

  Plan.findById = async () => ({
    _id: planId,
    contributorId: new mongoose.Types.ObjectId("507f1f77bcf86cd799439011"),
    status: "draft" // not submitted!
  });

  try {
    const req = {
      auth: { userId: "507f1f77bcf86cd799439088", role: "maintainer" },
      params: { id: String(planId) },
      body: {
        decision: "approved"
      },
      requestId: "req-review-conflict"
    };
    const res = mockResponse();

    await reviewPlan(req, res, () => {});

    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, "CONFLICT");
  } finally {
    Plan.findById = originalFindById;
  }
});
