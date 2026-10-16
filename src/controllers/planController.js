/**
 * ContrixAI — Contribution Plan Controller (M6 Lane)
 *
 * BLUEPRINT REFERENCE: ContrixAI Master Blueprint Edition 3.0 (Sections 05, 06, 08 - M6 Taskset).
 *
 * Responsibilities:
 * - Create a contributor's proposed starter plan (POST /api/contribution-plans)
 * - Read plan and review status with concealment rules (GET /api/contribution-plans/:id)
 * - Edit mutable fields & explicit submission transition (PATCH /api/contribution-plans/:id)
 * - Maintainer review & task ownership transition (POST /api/contribution-plans/:id/review)
 * - Agent service functions: submitForReview, maintainerReview
 */

const { z } = require("zod");
const mongoose = require("mongoose");

// ============================================================================
// STATUS TRANSITION MAP (Agreed with M5 & Blueprint Section 05)
// ============================================================================
const STATUS_TRANSITIONS = {
  draft: ["submitted"],
  submitted: ["approved", "rejected", "needs_changes"],
  needs_changes: ["submitted"],
  approved: [],
  rejected: []
};

// ============================================================================
// CANONICAL CONTRIBUTION PLAN SCHEMA (M5 Coordination / Self-healing fallback)
// ============================================================================
const StepSchema = new mongoose.Schema(
  {
    order: { type: Number, required: true },
    title: { type: String, required: true, trim: true },
    detail: { type: String, required: true, trim: true }
  },
  { _id: false }
);

const EvidenceRefSchema = new mongoose.Schema(
  {
    chunkId: { type: String, required: true, trim: true },
    snapshotId: { type: String, required: true, trim: true },
    path: { type: String, required: true, trim: true },
    heading: { type: String, required: true, trim: true }
  },
  { _id: false }
);

const StatusHistorySchema = new mongoose.Schema(
  {
    from: { type: String, required: true },
    to: { type: String, required: true },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    changedAt: { type: Date, default: Date.now },
    reason: { type: String, trim: true }
  },
  { _id: false }
);

const ContributionPlanSchema = new mongoose.Schema(
  {
    contributorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      required: true,
      index: true
    },
    issueId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ticket",
      required: true,
      index: true
    },
    approach: {
      type: String,
      required: true,
      trim: true,
      minlength: 10,
      maxlength: 2000
    },
    steps: {
      type: [StepSchema],
      required: true,
      validate: [
        (val) => Array.isArray(val) && val.length > 0 && val.length <= 20,
        "Steps must contain between 1 and 20 items"
      ]
    },
    evidenceRefs: {
      type: [EvidenceRefSchema],
      default: []
    },
    status: {
      type: String,
      enum: ["draft", "submitted", "needs_changes", "approved", "rejected"],
      default: "draft",
      index: true
    },
    reviewerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    },
    feedback: {
      type: String,
      trim: true,
      default: null
    },
    statusHistory: {
      type: [StatusHistorySchema],
      default: []
    },
    submittedAt: {
      type: Date,
      default: null
    },
    reviewedAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
);

// Compound index for queries: (contributorId, status) and (projectId, status)
ContributionPlanSchema.index({ contributorId: 1, status: 1 });
ContributionPlanSchema.index({ projectId: 1, status: 1 });

const ContributionPlan =
  mongoose.models.ContributionPlan ||
  mongoose.models.Plan ||
  mongoose.model("ContributionPlan", ContributionPlanSchema);

// ============================================================================
// ZOD VALIDATION SCHEMAS
// ============================================================================

const objectIdRegex = /^[0-9a-fA-F]{24}$/;
const zObjectId = z
  .string()
  .trim()
  .regex(objectIdRegex, "Must be a valid 24-character hexadecimal ObjectId");

const stepItemSchema = z.object({
  order: z.number().int().min(1, "Step order must be at least 1"),
  title: z.string().trim().min(3, "Step title must have at least 3 characters").max(100),
  detail: z.string().trim().min(5, "Step detail must have at least 5 characters").max(1000)
});

const evidenceRefSchema = z.object({
  chunkId: z.string().trim().min(1, "chunkId is required"),
  snapshotId: z.string().trim().min(1, "snapshotId is required"),
  path: z.string().trim().min(1, "path is required"),
  heading: z.string().trim().min(1, "heading is required")
});

const createPlanSchema = z.object({
  projectId: zObjectId,
  issueId: zObjectId,
  approach: z
    .string()
    .trim()
    .min(10, "Approach must be at least 10 characters")
    .max(2000, "Approach cannot exceed 2000 characters"),
  steps: z
    .array(stepItemSchema)
    .min(1, "At least one step is required")
    .max(20, "Maximum 20 steps allowed"),
  evidenceRefs: z.array(evidenceRefSchema).max(50, "Maximum 50 evidence references").optional().default([])
});

const updatePlanSchema = z
  .object({
    approach: z
      .string()
      .trim()
      .min(10, "Approach must be at least 10 characters")
      .max(2000, "Approach cannot exceed 2000 characters")
      .optional(),
    steps: z
      .array(stepItemSchema)
      .min(1, "At least one step is required")
      .max(20, "Maximum 20 steps allowed")
      .optional(),
    evidenceRefs: z.array(evidenceRefSchema).max(50).optional(),
    status: z.enum(["submitted"], {
      errorMap: () => ({
        message: "Only 'submitted' transition is allowed via PATCH update"
      })
    }).optional()
  })
  .strict("Unrecognized or non-mutable fields present in update payload");

const reviewPlanSchema = z
  .object({
    decision: z.enum(["approved", "rejected", "needs_changes"], {
      errorMap: () => ({
        message: "Decision must be one of 'approved', 'rejected', or 'needs_changes'"
      })
    }),
    feedback: z
      .string()
      .trim()
      .min(5, "Feedback must be at least 5 characters")
      .max(2000, "Feedback cannot exceed 2000 characters")
  })
  .strict();

// ============================================================================
// HELPER UTILITIES
// ============================================================================

function createError(message, status = 500, code = "SERVER_ERROR") {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

function normalizeId(id) {
  if (!id) return "";
  return typeof id === "object" && id._id ? id._id.toString() : id.toString();
}

/**
 * Validates consistency between Issue, Project, and Snapshot Evidence.
 * Coordinates with M7 Issue and Snapshot contracts.
 */
async function verifyIssueAndEvidenceConsistency(projectId, issueId, evidenceRefs = []) {
  // If models are registered in mongoose, execute live verification
  if (mongoose.models.Ticket || mongoose.models.Issue) {
    const IssueModel = mongoose.models.Ticket || mongoose.models.Issue;
    const issue = await IssueModel.findById(issueId).lean();
    if (!issue) {
      throw createError("Referenced issue does not exist", 400, "VALIDATION_ERROR");
    }
    if (normalizeId(issue.projectId) !== normalizeId(projectId)) {
      throw createError(
        "Issue does not belong to the specified project",
        400,
        "VALIDATION_ERROR"
      );
    }
  }

  // Verify evidence references belong to valid snapshot format
  if (Array.isArray(evidenceRefs) && evidenceRefs.length > 0) {
    for (const ref of evidenceRefs) {
      if (!ref.chunkId || !ref.snapshotId || !ref.path) {
        throw createError(
          "Evidence reference missing required fields (chunkId, snapshotId, path)",
          400,
          "VALIDATION_ERROR"
        );
      }
    }
  }
}

/**
 * Coordinates task ownership update with M7 upon plan approval
 */
async function recordTaskOwnership(plan, maintainerId) {
  if (mongoose.models.Ticket || mongoose.models.Issue) {
    const IssueModel = mongoose.models.Ticket || mongoose.models.Issue;
    await IssueModel.findByIdAndUpdate(plan.issueId, {
      status: "assigned",
      assigneeId: plan.contributorId,
      assignedBy: maintainerId,
      assignedAt: new Date()
    });
  }
}

// ============================================================================
// CONTROLLER HANDLERS
// ============================================================================

/**
 * POST /api/contribution-plans
 * Create a contributor's proposed starter plan in 'draft' status.
 */
async function createPlan(req, res, next) {
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId) {
      return next(createError("Authentication required", 401, "UNAUTHENTICATED"));
    }

    // 1. Zod Validation
    const parsed = createPlanSchema.safeParse(req.body);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0]?.message || "Validation failed";
      return next(createError(firstIssue, 400, "VALIDATION_ERROR"));
    }

    const { projectId, issueId, approach, steps, evidenceRefs } = parsed.data;

    // 2. Issue + Evidence consistency check
    await verifyIssueAndEvidenceConsistency(projectId, issueId, evidenceRefs);

    // 3. Create plan with contributorId strictly derived from session
    const plan = new ContributionPlan({
      contributorId: userId,
      projectId,
      issueId,
      approach,
      steps,
      evidenceRefs,
      status: "draft",
      statusHistory: [
        {
          from: "none",
          to: "draft",
          changedBy: userId,
          changedAt: new Date(),
          reason: "Initial draft creation"
        }
      ]
    });

    await plan.save();

    return res.status(201).json({
      success: true,
      data: plan,
      meta: {
        requestId: req.requestId || null
      }
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/contribution-plans/:id
 * Retrieve a plan only when the caller is authorized (owner or maintainer).
 * Uses the agreed 404 concealment rule for other users.
 */
async function getPlanById(req, res, next) {
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId) {
      return next(createError("Authentication required", 401, "UNAUTHENTICATED"));
    }

    const { id } = req.params;
    if (!objectIdRegex.test(id)) {
      return next(createError("Plan not found", 404, "NOT_FOUND"));
    }

    const plan = await ContributionPlan.findById(id);
    if (!plan) {
      return next(createError("Plan not found", 404, "NOT_FOUND"));
    }

    const isOwner = normalizeId(plan.contributorId) === normalizeId(userId);
    const isMaintainer =
      req.user?.role === "maintainer" ||
      req.user?.roles?.includes("maintainer") ||
      req.isMaintainer === true;

    // Concealment rule: If caller is not the owner and not an authorized maintainer,
    // return 404 NOT_FOUND to prevent enumeration.
    if (!isOwner && !isMaintainer) {
      return next(createError("Plan not found", 404, "NOT_FOUND"));
    }

    return res.json({
      success: true,
      data: plan,
      meta: {
        requestId: req.requestId || null
      }
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * PATCH /api/contribution-plans/:id
 * Edit an eligible plan and support its explicit submission transition.
 * Only owner may edit, and only when status is 'draft' or 'needs_changes'.
 */
async function updatePlan(req, res, next) {
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId) {
      return next(createError("Authentication required", 401, "UNAUTHENTICATED"));
    }

    const { id } = req.params;
    if (!objectIdRegex.test(id)) {
      return next(createError("Plan not found", 404, "NOT_FOUND"));
    }

    const plan = await ContributionPlan.findById(id);
    if (!plan) {
      return next(createError("Plan not found", 404, "NOT_FOUND"));
    }

    // Concealment / Ownership check: Only owner may edit
    const isOwner = normalizeId(plan.contributorId) === normalizeId(userId);
    if (!isOwner) {
      return next(createError("Plan not found", 404, "NOT_FOUND"));
    }

    // Status check: Editing is allowed ONLY in 'draft' or 'needs_changes'
    if (!["draft", "needs_changes"].includes(plan.status)) {
      return next(
        createError(
          `Cannot edit contribution plan in '${plan.status}' status. Submitted or resolved plans are locked.`,
          409,
          "CONFLICT"
        )
      );
    }

    // Validate update payload
    const parsed = updatePlanSchema.safeParse(req.body);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0]?.message || "Validation failed";
      return next(createError(firstIssue, 400, "VALIDATION_ERROR"));
    }

    const { approach, steps, evidenceRefs, status } = parsed.data;

    if (approach !== undefined) plan.approach = approach;
    if (steps !== undefined) plan.steps = steps;
    if (evidenceRefs !== undefined) plan.evidenceRefs = evidenceRefs;

    // Explicit submission transition
    if (status === "submitted") {
      const currentStatus = plan.status;
      const allowedNext = STATUS_TRANSITIONS[currentStatus] || [];
      if (!allowedNext.includes("submitted")) {
        return next(
          createError(
            `Invalid transition from '${currentStatus}' to 'submitted'`,
            409,
            "CONFLICT"
          )
        );
      }

      plan.status = "submitted";
      plan.submittedAt = new Date();
      plan.statusHistory.push({
        from: currentStatus,
        to: "submitted",
        changedBy: userId,
        changedAt: new Date(),
        reason: "Submitted by contributor for maintainer review"
      });
    }

    await plan.save();

    return res.json({
      success: true,
      data: plan,
      meta: {
        requestId: req.requestId || null
      }
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/contribution-plans/:id/review
 * Allow an authorized maintainer to review a submitted plan.
 */
async function reviewPlan(req, res, next) {
  try {
    const reviewerId = req.user?.id || req.user?._id;
    if (!reviewerId) {
      return next(createError("Authentication required", 401, "UNAUTHENTICATED"));
    }

    const { id } = req.params;
    if (!objectIdRegex.test(id)) {
      return next(createError("Plan not found", 404, "NOT_FOUND"));
    }

    const plan = await ContributionPlan.findById(id);
    if (!plan) {
      return next(createError("Plan not found", 404, "NOT_FOUND"));
    }

    // Role check: caller must be maintainer
    const isMaintainer =
      req.user?.role === "maintainer" ||
      req.user?.roles?.includes("maintainer") ||
      req.isMaintainer === true;
    if (!isMaintainer) {
      return next(
        createError(
          "Maintainer role required to review contribution plans",
          403,
          "FORBIDDEN"
        )
      );
    }

    // Anti-self-approval rule: Contributor cannot review their own plan
    if (normalizeId(plan.contributorId) === normalizeId(reviewerId)) {
      return next(
        createError(
          "Self-review is strictly prohibited. You cannot review your own contribution plan.",
          403,
          "FORBIDDEN"
        )
      );
    }

    // Status check: Plan must be in 'submitted' status to be reviewed
    if (plan.status !== "submitted") {
      return next(
        createError(
          `Cannot review plan in '${plan.status}' status. Only 'submitted' plans can be reviewed.`,
          409,
          "CONFLICT"
        )
      );
    }

    // Zod validation for review decision and feedback
    const parsed = reviewPlanSchema.safeParse(req.body);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0]?.message || "Validation failed";
      return next(createError(firstIssue, 400, "VALIDATION_ERROR"));
    }

    const { decision, feedback } = parsed.data;

    // Validate transition
    const allowedNext = STATUS_TRANSITIONS[plan.status] || [];
    if (!allowedNext.includes(decision)) {
      return next(
        createError(
          `Invalid review decision transition from '${plan.status}' to '${decision}'`,
          409,
          "CONFLICT"
        )
      );
    }

    const previousStatus = plan.status;
    plan.status = decision;
    plan.reviewerId = reviewerId;
    plan.feedback = feedback;
    plan.reviewedAt = new Date();

    plan.statusHistory.push({
      from: previousStatus,
      to: decision,
      changedBy: reviewerId,
      changedAt: new Date(),
      reason: feedback
    });

    await plan.save();

    // If approved, update task ownership per M7 contract
    if (decision === "approved") {
      await recordTaskOwnership(plan, reviewerId);
    }

    return res.json({
      success: true,
      data: plan,
      meta: {
        requestId: req.requestId || null
      }
    });
  } catch (err) {
    return next(err);
  }
}

// ============================================================================
// SERVICE FUNCTIONS FOR AGENT INTEGRATION (Blueprint Section 04-C / 08-M6)
// ============================================================================

/**
 * Service function: submitForReview(planId, user)
 * Used by the onboarding agent to submit a plan for review.
 */
async function submitForReview(planId, user) {
  const userId = normalizeId(user?.id || user?._id || user);
  if (!userId) {
    throw createError("User identity required", 401, "UNAUTHENTICATED");
  }

  const plan = await ContributionPlan.findById(planId);
  if (!plan) {
    throw createError("Plan not found", 404, "NOT_FOUND");
  }

  if (normalizeId(plan.contributorId) !== userId) {
    throw createError("Only the plan owner can submit for review", 403, "FORBIDDEN");
  }

  if (!["draft", "needs_changes"].includes(plan.status)) {
    throw createError(
      `Cannot submit plan in '${plan.status}' status`,
      409,
      "CONFLICT"
    );
  }

  const previousStatus = plan.status;
  plan.status = "submitted";
  plan.submittedAt = new Date();
  plan.statusHistory.push({
    from: previousStatus,
    to: "submitted",
    changedBy: userId,
    changedAt: new Date(),
    reason: "Submitted via onboarding agent workflow"
  });

  await plan.save();
  return plan;
}

/**
 * Service function: maintainerReview(planId, decision, feedback, reviewer)
 * Used by the onboarding agent or maintainer workflow.
 */
async function maintainerReview(planId, decision, feedback, reviewer) {
  const reviewerId = normalizeId(reviewer?.id || reviewer?._id || reviewer);
  if (!reviewerId) {
    throw createError("Reviewer identity required", 401, "UNAUTHENTICATED");
  }

  const plan = await ContributionPlan.findById(planId);
  if (!plan) {
    throw createError("Plan not found", 404, "NOT_FOUND");
  }

  if (normalizeId(plan.contributorId) === reviewerId) {
    throw createError("Maintainer cannot review their own plan", 403, "FORBIDDEN");
  }

  if (plan.status !== "submitted") {
    throw createError(`Cannot review plan in '${plan.status}' status`, 409, "CONFLICT");
  }

  if (!["approved", "rejected", "needs_changes"].includes(decision)) {
    throw createError("Invalid decision", 400, "VALIDATION_ERROR");
  }

  const previousStatus = plan.status;
  plan.status = decision;
  plan.reviewerId = reviewerId;
  plan.feedback = feedback;
  plan.reviewedAt = new Date();
  plan.statusHistory.push({
    from: previousStatus,
    to: decision,
    changedBy: reviewerId,
    changedAt: new Date(),
    reason: feedback
  });

  await plan.save();

  if (decision === "approved") {
    await recordTaskOwnership(plan, reviewerId);
  }

  return plan;
}

module.exports = {
  // Controller handlers
  createPlan,
  getPlanById,
  updatePlan,
  reviewPlan,

  // Service functions for AI agent
  submitForReview,
  maintainerReview,

  // Zod schemas (exported for route middleware / cross-lane testing)
  createPlanSchema,
  updatePlanSchema,
  reviewPlanSchema,

  // Models and constants
  ContributionPlan,
  STATUS_TRANSITIONS
};
