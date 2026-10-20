"use strict";

const mongoose = require("mongoose");
const { z } = require("zod");
const { Plan, STATUS_TRANSITIONS } = require("../models/Plan");
const { Membership } = require("../models/Membership");
const { Issue } = require("../models/Ticket");

const httpError = (status, code, message) => Object.assign(new Error(message), { status, code });

function transitionAllowed(from, to) {
  return Array.isArray(STATUS_TRANSITIONS[from]) && STATUS_TRANSITIONS[from].includes(to);
}

async function findIssueForPlan(issueId) {
  const clauses = [{ sourceId: issueId }];
  if (mongoose.isValidObjectId(issueId)) clauses.push({ _id: issueId });
  return Issue.findOne({ $or: clauses });
}

async function assertIssueProject(issueId, projectId) {
  const issue = await findIssueForPlan(issueId);
  if (!issue || String(issue.projectId) !== String(projectId)) {
    throw httpError(422, "VALIDATION_ERROR", "The issue does not belong to the selected project");
  }
  if (issue.status === "closed") {
    throw httpError(409, "CONFLICT", "A closed issue cannot receive a contribution plan");
  }
  return issue;
}

async function assertMaintainerMembership(auth, projectId) {
  if (auth.role !== "maintainer" || auth.maintainerVerified !== true) {
    throw httpError(403, "FORBIDDEN", "Verified maintainer access is required");
  }
  const membership = await Membership.findOne({ userId: auth.userId, projectId: String(projectId), role: "maintainer", status: "active" }).lean();
  if (!membership) throw httpError(403, "FORBIDDEN", "Active maintainer membership for this project is required");
  return membership;
}

async function assertEvidenceRefs(evidenceRefs, projectId, issue) {
  if (!evidenceRefs || evidenceRefs.length === 0) return;
  const snapshotIds = new Set(evidenceRefs.map((ref) => ref.snapshotId));
  if (snapshotIds.size !== 1) throw httpError(400, "VALIDATION_ERROR", "All evidence references must belong to one snapshot");
  const snapshotId = [...snapshotIds][0];
  if (issue.snapshotId && String(issue.snapshotId) !== String(snapshotId)) {
    throw httpError(422, "VALIDATION_ERROR", "Evidence snapshot does not match the issue snapshot");
  }
  // D3 owns these models. Evidence is rejected rather than trusted if they are not wired.
  const Snapshot = mongoose.models.RepositorySnapshot;
  const Chunk = mongoose.models.DocumentChunk || mongoose.models.Document;
  if (!Snapshot || !Chunk) throw httpError(503, "INTEGRATION_NOT_READY", "Snapshot and document-chunk models must be registered before evidence can be validated");
  const snapshot = await Snapshot.findOne({ $or: [{ _id: mongoose.isValidObjectId(snapshotId) ? snapshotId : null }, { snapshotId }] });
  if (!snapshot || String(snapshot.projectId) !== String(projectId) || ["failed", "revoked"].includes(snapshot.status)) {
    throw httpError(422, "VALIDATION_ERROR", "Evidence snapshot is missing, unavailable, or belongs to another project");
  }
  for (const ref of evidenceRefs) {
    const chunk = await Chunk.findOne({ $or: [{ _id: mongoose.isValidObjectId(ref.chunkId) ? ref.chunkId : null }, { chunkId: ref.chunkId }, { id: ref.chunkId }], snapshotId: snapshot._id });
    if (!chunk) throw httpError(422, "VALIDATION_ERROR", `Evidence chunk '${ref.chunkId}' was not found in the selected snapshot`);
    if (chunk.projectId && String(chunk.projectId) !== String(projectId)) throw httpError(422, "VALIDATION_ERROR", "Evidence chunk belongs to another project");
  }
}
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

    const issue = await assertIssueProject(validated.issueId, validated.projectId);
    if (validated.evidenceRefs.length > 0) {
      if (validated.snapshotId && validated.evidenceRefs.some((ref) => ref.snapshotId !== validated.snapshotId)) {
        throw httpError(400, "VALIDATION_ERROR", "Evidence references must belong to the plan's snapshot");
      }
      await assertEvidenceRefs(validated.evidenceRefs, validated.projectId, issue);
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
    let isAuthorizedMaintainer = false;
    if (!isOwner && req.auth.role === "maintainer" && req.auth.maintainerVerified === true) {
      const membership = await Membership.findOne({ userId: req.auth.userId, projectId: String(plan.projectId), role: "maintainer", status: "active" }).lean();
      isAuthorizedMaintainer = Boolean(membership);
    }

    if (!isOwner && !isAuthorizedMaintainer) {
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

    if (validated.evidenceRefs !== undefined) {
      const issue = await assertIssueProject(plan.issueId, plan.projectId);
      if (validated.evidenceRefs.length > 0) {
        if (validated.snapshotId && validated.evidenceRefs.some((ref) => ref.snapshotId !== validated.snapshotId)) {
          throw httpError(400, "VALIDATION_ERROR", "Evidence references must belong to the plan's snapshot");
        }
        await assertEvidenceRefs(validated.evidenceRefs, plan.projectId, issue);
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
      if (!transitionAllowed(plan.status, "submitted")) {
        throw httpError(409, "CONFLICT", `Transition from '${plan.status}' to 'submitted' is not allowed`);
      }
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

    await assertMaintainerMembership(req.auth, plan.projectId);

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
    if (!transitionAllowed(oldStatus, validated.decision)) {
      throw httpError(409, "CONFLICT", `Transition from '${oldStatus}' to '${validated.decision}' is not allowed`);
    }

    // Approval must never be persisted unless the issue exists and is assignable.
    let issueToAssign = null;
    if (validated.decision === "approved") {
      issueToAssign = await assertIssueProject(plan.issueId, plan.projectId);
      if (issueToAssign.status === "assigned" && String(issueToAssign.assigneeId) !== String(plan.contributorId)) {
        throw httpError(409, "CONFLICT", "The issue is already assigned to another contributor");
      }
    }

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

    if (validated.decision === "approved") {
      // Persist assignment first; if it fails, do not approve the plan.
      const assignment = await Issue.findOneAndUpdate(
        { _id: issueToAssign._id, status: { $in: ["open", "assigned"] }, $or: [{ assigneeId: null }, { assigneeId: plan.contributorId }] },
        { $set: { status: "assigned", assigneeId: plan.contributorId } },
        { new: true, runValidators: true }
      );
      if (!assignment) throw httpError(409, "CONFLICT", "Issue assignment changed concurrently; reload and retry");
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
