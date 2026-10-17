"use strict";

const mongoose = require("mongoose");
const { z } = require("zod");
const { Plan, STATUS_TRANSITIONS } = require("../models/Plan");

const stepSchema = z.object({
  order: z.number({ required_error: "Step order is required" }).int().min(1),
  title: z.string({ required_error: "Step title is required" }).trim().min(1, "Step title is required").max(200),
  detail: z.string().trim().max(2000).optional().default("")
});

const evidenceRefSchema = z.object({
  chunkId: z.string({ required_error: "chunkId is required" }).trim().min(1),
  snapshotId: z.string({ required_error: "snapshotId is required" }).trim().min(1),
  snapshotVersion: z.string().trim().optional(),
  path: z.string({ required_error: "path is required" }).trim().min(1),
  heading: z.string().trim().optional()
});

const createPlanSchema = z.object({
  projectId: z.string({ required_error: "projectId is required" }).trim().min(1, "projectId is required"),
  issueId: z.string({ required_error: "issueId is required" }).trim().min(1, "issueId is required"),
  approach: z.string({ required_error: "approach description is required" }).trim().min(10, "Approach must be at least 10 characters").max(4000),
  steps: z.array(stepSchema).min(1, "At least one plan step is required"),
  evidenceRefs: z.array(evidenceRefSchema).optional().default([]),
  snapshotId: z.string().trim().optional()
});

const updatePlanSchema = z.object({
  approach: z.string().trim().min(10, "Approach must be at least 10 characters").max(4000).optional(),
  steps: z.array(stepSchema).min(1, "At least one step required if steps are provided").optional(),
  evidenceRefs: z.array(evidenceRefSchema).optional(),
  snapshotId: z.string().trim().optional(),
  status: z.enum(["submitted"], {
    errorMap: () => ({ message: "Contributors can only transition status to 'submitted'" })
  }).optional()
});

const reviewPlanSchema = z.object({
  decision: z.enum(["approved", "rejected", "needs_changes"], {
    errorMap: () => ({ message: "Decision must be one of: approved, rejected, needs_changes" })
  }),
  feedback: z.string().trim().max(2000).optional().default("")
});

function validateEvidenceSnapshot(evidenceRefs, targetSnapshotId) {
  if (!evidenceRefs || evidenceRefs.length === 0) return true;
  const snapshotId = targetSnapshotId || evidenceRefs[0].snapshotId;
  return evidenceRefs.every((ref) => ref.snapshotId === snapshotId);
}

const createPlan = async (req, res, next) => {
  try {
    if (!req.auth || !req.auth.userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication is required",
        code: "UNAUTHENTICATED",
        requestId: req.requestId || null
      });
    }

    const validated = createPlanSchema.parse(req.body);

    // T10: Evidence references must point to chunks within the plan's authorized snapshot
    if (validated.evidenceRefs.length > 0) {
      const valid = validateEvidenceSnapshot(validated.evidenceRefs, validated.snapshotId);
      if (!valid) {
        return res.status(400).json({
          success: false,
          message: "Evidence references must belong to the plan's snapshot",
          code: "VALIDATION_ERROR",
          requestId: req.requestId || null
        });
      }
    }

    // Identity is strictly derived from session; body-supplied contributor/reviewer/status ignored
    const plan = await Plan.create({
      contributorId: req.auth.userId,
      projectId: validated.projectId,
      issueId: validated.issueId,
      approach: validated.approach,
      steps: validated.steps,
      evidenceRefs: validated.evidenceRefs,
      status: "draft",
      statusHistory: [
        {
          from: null,
          to: "draft",
          changedBy: req.auth.userId,
          changedAt: new Date(),
          reason: "Initial plan draft"
        }
      ]
    });

    return res.status(201).json({
      success: true,
      data: { plan },
      meta: {
        requestId: req.requestId || null
      }
    });
  } catch (error) {
    return next(error);
  }
};

const getPlan = async (req, res, next) => {
  try {
    if (!req.auth || !req.auth.userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication is required",
        code: "UNAUTHENTICATED",
        requestId: req.requestId || null
      });
    }

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid plan identifier",
        code: "VALIDATION_ERROR",
        requestId: req.requestId || null
      });
    }

    const plan = await Plan.findById(id);
    if (!plan) {
      return res.status(404).json({
        success: false,
        message: "The requested resource was not found",
        code: "NOT_FOUND",
        requestId: req.requestId || null
      });
    }

    // T08: Conceal or deny plan if caller is another contributor
    const isOwner = String(plan.contributorId) === String(req.auth.userId);
    const isStaff = req.auth.role === "maintainer" || req.auth.role === "moderator";

    if (!isOwner && !isStaff) {
      return res.status(404).json({
        success: false,
        message: "The requested resource was not found",
        code: "NOT_FOUND",
        requestId: req.requestId || null
      });
    }

    return res.status(200).json({
      success: true,
      data: { plan },
      meta: {
        requestId: req.requestId || null
      }
    });
  } catch (error) {
    return next(error);
  }
};

const updatePlan = async (req, res, next) => {
  try {
    if (!req.auth || !req.auth.userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication is required",
        code: "UNAUTHENTICATED",
        requestId: req.requestId || null
      });
    }

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid plan identifier",
        code: "VALIDATION_ERROR",
        requestId: req.requestId || null
      });
    }

    const plan = await Plan.findById(id);
    if (!plan) {
      return res.status(404).json({
        success: false,
        message: "The requested resource was not found",
        code: "NOT_FOUND",
        requestId: req.requestId || null
      });
    }

    // Only plan owner can edit draft or needs_changes
    const isOwner = String(plan.contributorId) === String(req.auth.userId);
    if (!isOwner) {
      return res.status(404).json({
        success: false,
        message: "The requested resource was not found",
        code: "NOT_FOUND",
        requestId: req.requestId || null
      });
    }

    // T09: When a submitted plan is edited, return 409 CONFLICT
    if (!["draft", "needs_changes"].includes(plan.status)) {
      return res.status(409).json({
        success: false,
        message: `Cannot edit a contribution plan in '${plan.status}' status`,
        code: "CONFLICT",
        requestId: req.requestId || null
      });
    }

    const validated = updatePlanSchema.parse(req.body);

    if (validated.evidenceRefs && validated.evidenceRefs.length > 0) {
      const valid = validateEvidenceSnapshot(validated.evidenceRefs, validated.snapshotId);
      if (!valid) {
        return res.status(400).json({
          success: false,
          message: "Evidence references must belong to the plan's snapshot",
          code: "VALIDATION_ERROR",
          requestId: req.requestId || null
        });
      }
      plan.evidenceRefs = validated.evidenceRefs;
    }

    if (validated.approach !== undefined) {
      plan.approach = validated.approach;
    }

    if (validated.steps !== undefined) {
      plan.steps = validated.steps;
    }

    if (validated.status === "submitted") {
      const oldStatus = plan.status;
      plan.status = "submitted";
      plan.submittedAt = new Date();
      plan.statusHistory.push({
        from: oldStatus,
        to: "submitted",
        changedBy: req.auth.userId,
        changedAt: new Date(),
        reason: "Submitted for maintainer review"
      });
    }

    await plan.save();

    return res.status(200).json({
      success: true,
      data: { plan },
      meta: {
        requestId: req.requestId || null
      }
    });
  } catch (error) {
    return next(error);
  }
};

const reviewPlan = async (req, res, next) => {
  try {
    if (!req.auth || !req.auth.userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication is required",
        code: "UNAUTHENTICATED",
        requestId: req.requestId || null
      });
    }

    // Role check: maintainer only
    if (req.auth.role !== "maintainer") {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to review contribution plans",
        code: "FORBIDDEN",
        requestId: req.requestId || null
      });
    }

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid plan identifier",
        code: "VALIDATION_ERROR",
        requestId: req.requestId || null
      });
    }

    const plan = await Plan.findById(id);
    if (!plan) {
      return res.status(404).json({
        success: false,
        message: "The requested resource was not found",
        code: "NOT_FOUND",
        requestId: req.requestId || null
      });
    }

    // T05: Contributor cannot review their own plan
    if (String(plan.contributorId) === String(req.auth.userId)) {
      return res.status(403).json({
        success: false,
        message: "Maintainers cannot review their own contribution plan",
        code: "FORBIDDEN",
        requestId: req.requestId || null
      });
    }

    // Status check: plan must be in 'submitted' state
    if (plan.status !== "submitted") {
      return res.status(409).json({
        success: false,
        message: `Cannot review plan: status is '${plan.status}', expected 'submitted'`,
        code: "CONFLICT",
        requestId: req.requestId || null
      });
    }

    const validated = reviewPlanSchema.parse(req.body);

    const oldStatus = plan.status;
    plan.status = validated.decision;
    plan.reviewerId = req.auth.userId;
    plan.feedback = validated.feedback;
    plan.reviewedAt = new Date();
    plan.statusHistory.push({
      from: oldStatus,
      to: validated.decision,
      changedBy: req.auth.userId,
      changedAt: new Date(),
      reason: validated.feedback || `Maintainer decision: ${validated.decision}`
    });

    // If approved and an issue model is registered, attempt to record assignment
    if (validated.decision === "approved") {
      try {
        const IssueModel = mongoose.models.Issue || mongoose.models.Ticket;
        if (IssueModel) {
          await IssueModel.findOneAndUpdate(
            { _id: plan.issueId },
            { status: "assigned", assigneeId: plan.contributorId }
          );
        }
      } catch {
        // Non-fatal if issue model not registered
      }
    }

    await plan.save();

    return res.status(200).json({
      success: true,
      data: { plan },
      meta: {
        requestId: req.requestId || null
      }
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  createPlan,
  getPlan,
  updatePlan,
  reviewPlan
};
