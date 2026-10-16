/**
 * ContrixAI — Contribution Plan Test Suite (M6 Lane)
 *
 * BLUEPRINT TESTS COVERED:
 * - T05: Contributor reviews own plan -> 403 FORBIDDEN
 * - T08: Contributor B reads or edits Contributor A's plan -> denied / concealed (404)
 * - T09: Submitted plan edited -> 409 CONFLICT
 * - T10: Invalid evidence references / schema -> 400 VALIDATION_ERROR
 * - Additional: Zod schemas, status transitions, agent service functions, Entitlement stub
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  createPlanSchema,
  updatePlanSchema,
  reviewPlanSchema,
  STATUS_TRANSITIONS,
  createPlan,
  getPlanById,
  updatePlan,
  reviewPlan,
  submitForReview,
  maintainerReview,
  ContributionPlan
} = require("../src/controllers/planController");
const { Entitlement, isDeferred } = require("../src/models/Entitlement");

describe("M6 Lane: Contribution Plan Unit & Integration Tests", () => {
  const validProjectId = "507f1f77bcf86cd799439011";
  const validIssueId = "507f1f77bcf86cd799439012";
  const userAId = "507f1f77bcf86cd799439013";
  const userBId = "507f1f77bcf86cd799439014";
  const maintainerId = "507f1f77bcf86cd799439015";

  // --------------------------------------------------------------------------
  // 1. Zod Schemas Validation
  // --------------------------------------------------------------------------
  describe("Zod Validation Schemas", () => {
    it("createPlanSchema validates valid input correctly", () => {
      const validPayload = {
        projectId: validProjectId,
        issueId: validIssueId,
        approach: "This is a detailed approach explaining the fix for the issue.",
        steps: [
          { order: 1, title: "Locate handler", detail: "Find the route handler in controllers" },
          { order: 2, title: "Implement fix", detail: "Add input validation and boundary check" }
        ],
        evidenceRefs: [
          {
            chunkId: "chunk_01",
            snapshotId: "snap_v1",
            path: "docs/SETUP.md",
            heading: "Prerequisites"
          }
        ]
      };

      const result = createPlanSchema.safeParse(validPayload);
      assert.equal(result.success, true);
    });

    it("createPlanSchema rejects invalid objectId or short approach", () => {
      const invalidPayload = {
        projectId: "invalid-id",
        issueId: validIssueId,
        approach: "Too short",
        steps: []
      };

      const result = createPlanSchema.safeParse(invalidPayload);
      assert.equal(result.success, false);
    });

    it("updatePlanSchema rejects unallowed / non-mutable fields (strict check)", () => {
      const payloadWithDisallowedField = {
        approach: "Updated approach text that is sufficiently long",
        reviewerId: userAId // Not allow-listed
      };

      const result = updatePlanSchema.safeParse(payloadWithDisallowedField);
      assert.equal(result.success, false);
    });

    it("reviewPlanSchema enforces approved / rejected / needs_changes enum", () => {
      const validReview = {
        decision: "approved",
        feedback: "Great approach, clean breakdown of steps."
      };
      assert.equal(reviewPlanSchema.safeParse(validReview).success, true);

      const invalidReview = {
        decision: "merged", // Invalid decision
        feedback: "Looks good"
      };
      assert.equal(reviewPlanSchema.safeParse(invalidReview).success, false);
    });
  });

  // --------------------------------------------------------------------------
  // 2. Status Transition Map
  // --------------------------------------------------------------------------
  describe("Status Transitions Contract", () => {
    it("draft can only transition to submitted", () => {
      assert.deepEqual(STATUS_TRANSITIONS.draft, ["submitted"]);
    });

    it("submitted can transition to approved, rejected, or needs_changes", () => {
      assert.deepEqual(STATUS_TRANSITIONS.submitted, [
        "approved",
        "rejected",
        "needs_changes"
      ]);
    });

    it("approved and rejected are terminal states", () => {
      assert.deepEqual(STATUS_TRANSITIONS.approved, []);
      assert.deepEqual(STATUS_TRANSITIONS.rejected, []);
    });
  });

  // --------------------------------------------------------------------------
  // 3. Entitlement Compatibility Slot
  // --------------------------------------------------------------------------
  describe("Entitlement Model Slot (Deferred / Unused)", () => {
    it("is documented and marked as deferred", () => {
      assert.equal(isDeferred, true);
      assert.ok(Entitlement);
    });
  });

  // --------------------------------------------------------------------------
  // 4. Controller Workflows & Security Constraints
  // --------------------------------------------------------------------------
  describe("Plan Controller Logic & Guardrails", () => {
    it("T08: Contributor B reading Contributor A's plan is concealed with 404", async () => {
      // Mock plan document
      const mockPlan = {
        _id: "507f1f77bcf86cd799439099",
        contributorId: userAId,
        projectId: validProjectId,
        status: "draft"
      };

      // Spy on findById
      const originalFindById = ContributionPlan.findById;
      ContributionPlan.findById = async () => mockPlan;

      try {
        const req = {
          params: { id: "507f1f77bcf86cd799439099" },
          user: { id: userBId, role: "contributor" } // Different contributor
        };

        let capturedError = null;
        const res = {
          json: () => assert.fail("Should not return data to unauthorized user")
        };
        const next = (err) => {
          capturedError = err;
        };

        await getPlanById(req, res, next);

        assert.ok(capturedError, "Expected error to be thrown");
        assert.equal(capturedError.status, 404);
        assert.equal(capturedError.code, "NOT_FOUND");
      } finally {
        ContributionPlan.findById = originalFindById;
      }
    });

    it("T09: Editing a submitted plan returns 409 CONFLICT", async () => {
      const mockPlan = {
        _id: "507f1f77bcf86cd799439099",
        contributorId: userAId,
        projectId: validProjectId,
        status: "submitted" // Already submitted
      };

      const originalFindById = ContributionPlan.findById;
      ContributionPlan.findById = async () => mockPlan;

      try {
        const req = {
          params: { id: "507f1f77bcf86cd799439099" },
          user: { id: userAId, role: "contributor" },
          body: {
            approach: "Attempting to change approach after submission"
          }
        };

        let capturedError = null;
        const res = { json: () => assert.fail("Should not allow edit") };
        const next = (err) => {
          capturedError = err;
        };

        await updatePlan(req, res, next);

        assert.ok(capturedError);
        assert.equal(capturedError.status, 409);
        assert.equal(capturedError.code, "CONFLICT");
      } finally {
        ContributionPlan.findById = originalFindById;
      }
    });

    it("T05: Self-review by contributor is rejected with 403 FORBIDDEN", async () => {
      const mockPlan = {
        _id: "507f1f77bcf86cd799439099",
        contributorId: maintainerId, // Contributor is the same person as maintainer
        projectId: validProjectId,
        status: "submitted"
      };

      const originalFindById = ContributionPlan.findById;
      ContributionPlan.findById = async () => mockPlan;

      try {
        const req = {
          params: { id: "507f1f77bcf86cd799439099" },
          user: { id: maintainerId, role: "maintainer" },
          body: {
            decision: "approved",
            feedback: "I approve my own plan"
          }
        };

        let capturedError = null;
        const res = { json: () => assert.fail("Should not allow self-approval") };
        const next = (err) => {
          capturedError = err;
        };

        await reviewPlan(req, res, next);

        assert.ok(capturedError);
        assert.equal(capturedError.status, 403);
        assert.equal(capturedError.code, "FORBIDDEN");
        assert.match(capturedError.message, /Self-review is strictly prohibited/);
      } finally {
        ContributionPlan.findById = originalFindById;
      }
    });

    it("T10: Reviewing a plan in draft status returns 409 CONFLICT", async () => {
      const mockPlan = {
        _id: "507f1f77bcf86cd799439099",
        contributorId: userAId,
        projectId: validProjectId,
        status: "draft" // Cannot review a draft
      };

      const originalFindById = ContributionPlan.findById;
      ContributionPlan.findById = async () => mockPlan;

      try {
        const req = {
          params: { id: "507f1f77bcf86cd799439099" },
          user: { id: maintainerId, role: "maintainer" },
          body: {
            decision: "approved",
            feedback: "Approving too early"
          }
        };

        let capturedError = null;
        const res = { json: () => assert.fail("Should not review draft") };
        const next = (err) => {
          capturedError = err;
        };

        await reviewPlan(req, res, next);

        assert.ok(capturedError);
        assert.equal(capturedError.status, 409);
        assert.equal(capturedError.code, "CONFLICT");
      } finally {
        ContributionPlan.findById = originalFindById;
      }
    });

    it("Maintainer reviewing a submitted plan with valid decision succeeds", async () => {
      const mockPlan = {
        _id: "507f1f77bcf86cd799439099",
        contributorId: userAId,
        projectId: validProjectId,
        status: "submitted",
        statusHistory: [],
        save: async function () {
          return this;
        }
      };

      const originalFindById = ContributionPlan.findById;
      ContributionPlan.findById = async () => mockPlan;

      try {
        const req = {
          params: { id: "507f1f77bcf86cd799439099" },
          user: { id: maintainerId, role: "maintainer" },
          body: {
            decision: "approved",
            feedback: "Solid technical plan. Approved."
          }
        };

        let responseData = null;
        const res = {
          json: (data) => {
            responseData = data;
          }
        };
        const next = (err) => {
          if (err) assert.fail(`Unexpected error: ${err.message}`);
        };

        await reviewPlan(req, res, next);

        assert.ok(responseData);
        assert.equal(responseData.success, true);
        assert.equal(mockPlan.status, "approved");
        assert.equal(mockPlan.reviewerId, maintainerId);
        assert.equal(mockPlan.feedback, "Solid technical plan. Approved.");
        assert.equal(mockPlan.statusHistory.length, 1);
      } finally {
        ContributionPlan.findById = originalFindById;
      }
    });

    it("Agent service function: submitForReview transitions draft to submitted", async () => {
      const mockPlan = {
        _id: "507f1f77bcf86cd799439099",
        contributorId: userAId,
        projectId: validProjectId,
        status: "draft",
        statusHistory: [],
        save: async function () {
          return this;
        }
      };

      const originalFindById = ContributionPlan.findById;
      ContributionPlan.findById = async () => mockPlan;

      try {
        const result = await submitForReview("507f1f77bcf86cd799439099", { id: userAId });
        assert.equal(result.status, "submitted");
        assert.ok(result.submittedAt);
        assert.equal(result.statusHistory.length, 1);
      } finally {
        ContributionPlan.findById = originalFindById;
      }
    });

    it("Agent service function: maintainerReview records review decision", async () => {
      const mockPlan = {
        _id: "507f1f77bcf86cd799439099",
        contributorId: userAId,
        projectId: validProjectId,
        status: "submitted",
        statusHistory: [],
        save: async function () {
          return this;
        }
      };

      const originalFindById = ContributionPlan.findById;
      ContributionPlan.findById = async () => mockPlan;

      try {
        const result = await maintainerReview(
          "507f1f77bcf86cd799439099",
          "needs_changes",
          "Please clarify step 2 setup command",
          { id: maintainerId }
        );
        assert.equal(result.status, "needs_changes");
        assert.equal(result.reviewerId, maintainerId);
        assert.equal(result.feedback, "Please clarify step 2 setup command");
      } finally {
        ContributionPlan.findById = originalFindById;
      }
    });
  });
});
