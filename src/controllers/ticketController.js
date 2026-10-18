"use strict";

const mongoose = require("mongoose");
const { z } = require("zod");
const { httpError, assertProjectAccess } = require("../middleware/roleMiddleware");
const {
  Issue,
  Ticket,
  IssueInterest,
  ISSUE_STATUS,
  ISSUE_STATUS_TRANSITIONS
} = require("../models/Ticket");

/**
 * Access check helper (isolates guard layer for M7 controllers)
 */
async function verifyProjectAccess(auth, projectId, options) {
  return assertProjectAccess(auth, projectId, options);
}

/**
 * Common Zod Schemas
 */
const objectIdSchema = z
  .string()
  .trim()
  .regex(/^[a-f\d]{24}$/i, "Invalid ObjectId format");

const listProjectsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).default(20)
});

const listProjectIssuesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).default(20),
  status: z.enum(["open", "assigned", "closed"]).optional(),
  label: z.string().trim().max(40).optional()
});

const patchPrerequisiteSchema = z.object({
  label: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(1000),
  docRef: z.string().trim().max(300).optional()
});

const patchIssueBodySchema = z.object({
  status: z.enum(["open", "assigned", "closed"]).optional(),
  assigneeId: z
    .string()
    .trim()
    .regex(/^[a-f\d]{24}$/i, "Invalid assigneeId format")
    .nullable()
    .optional(),
  requirements: z.array(z.string().trim().min(1).max(300)).max(20).optional(),
  prerequisites: z.array(patchPrerequisiteSchema).max(20).optional()
});

/**
 * Serializers
 */
function isApprovedPublicProject(project) {
  if (!project) return false;
  const isPublic = project.visibility === "public";
  const isApproved = project.approved === true || project.status === "approved";
  return isPublic && isApproved;
}

function serializeProject(p, openIssueCount = 0) {
  const out = {
    _id: String(p._id),
    name: p.name,
    slug: p.slug,
    description: p.description || "",
    visibility: p.visibility,
    status: p.status || (p.approved ? "approved" : "pending"),
    openIssueCount
  };
  if (p.createdAt) out.createdAt = p.createdAt;
  if (p.updatedAt) out.updatedAt = p.updatedAt;
  return out;
}

function serializePublicIssue(doc) {
  return {
    _id: String(doc._id),
    projectId: String(doc.projectId),
    sourceId: doc.sourceId,
    title: doc.title,
    body: doc.body || "",
    labels: Array.isArray(doc.labels) ? doc.labels : [],
    requirements: Array.isArray(doc.requirements) ? doc.requirements : [],
    prerequisites: Array.isArray(doc.prerequisites)
      ? doc.prerequisites.map((p) => {
          const item = { label: p.label, description: p.description };
          if (p.docRef) item.docRef = p.docRef;
          return item;
        })
      : [],
    status: doc.status,
    assigned: doc.status === "assigned",
    sourceVersion: doc.sourceVersion || null,
    snapshotId: doc.snapshotId || null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
  };
}

function serializeMaintainerIssue(doc) {
  return {
    _id: String(doc._id),
    projectId: String(doc.projectId),
    sourceId: doc.sourceId,
    title: doc.title,
    body: doc.body || "",
    labels: Array.isArray(doc.labels) ? doc.labels : [],
    requirements: Array.isArray(doc.requirements) ? doc.requirements : [],
    prerequisites: Array.isArray(doc.prerequisites)
      ? doc.prerequisites.map((p) => {
          const item = { label: p.label, description: p.description };
          if (p.docRef) item.docRef = p.docRef;
          return item;
        })
      : [],
    status: doc.status,
    assigned: doc.status === "assigned",
    assigneeId: doc.assigneeId ? String(doc.assigneeId) : null,
    sourceVersion: doc.sourceVersion || null,
    snapshotId: doc.snapshotId || null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
  };
}

/**
 * 1. GET /api/projects
 * Browse approved + public projects with openIssueCount.
 */
const listProjects = async (req, res, next) => {
  try {
    const parsedQuery = listProjectsQuerySchema.parse(req.query);
    const page = parsedQuery.page;
    const limit = Math.min(parsedQuery.limit, 50);

    const ProjectModel = mongoose.models.Project;
    if (!ProjectModel) {
      throw httpError(500, "SERVER_ERROR", "Project model is not registered");
    }

    const filter = {
      visibility: "public",
      $or: [{ approved: true }, { status: "approved" }]
    };

    const total = await ProjectModel.countDocuments(filter);
    const projects = await ProjectModel.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    const projectIds = projects.map((p) => p._id);
    const counts = await Issue.aggregate([
      {
        $match: {
          projectId: { $in: projectIds },
          status: "open"
        }
      },
      {
        $group: {
          _id: "$projectId",
          count: { $sum: 1 }
        }
      }
    ]);

    const countMap = new Map(counts.map((c) => [String(c._id), c.count]));
    const data = projects.map((p) => serializeProject(p, countMap.get(String(p._id)) || 0));

    return res.status(200).json({
      success: true,
      data: { projects: data },
      meta: {
        requestId: req.requestId || null,
        pagination: {
          page,
          limit,
          total
        }
      }
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * 2. GET /api/projects/:projectId/issues
 * Public/authorized issue listing with pagination & filters.
 */
const listProjectIssues = async (req, res, next) => {
  try {
    const projectId = objectIdSchema.parse(req.params.projectId);
    const parsedQuery = listProjectIssuesQuerySchema.parse(req.query);
    const page = parsedQuery.page;
    const limit = Math.min(parsedQuery.limit, 50);

    // Conceal private projects from unauthorized callers via assertProjectAccess
    await verifyProjectAccess(req.auth || null, projectId);

    const filter = {
      projectId: new mongoose.Types.ObjectId(projectId)
    };
    if (parsedQuery.status) {
      filter.status = parsedQuery.status;
    }
    if (parsedQuery.label) {
      filter.labels = parsedQuery.label;
    }

    const total = await Issue.countDocuments(filter);
    const issues = await Issue.find(filter)
      .sort({ updatedAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    return res.status(200).json({
      success: true,
      data: {
        issues: issues.map(serializePublicIssue)
      },
      meta: {
        requestId: req.requestId || null,
        pagination: {
          page,
          limit,
          total
        }
      }
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * 3. POST /api/issues/:id/interest
 * Contributor interest expression on open issues.
 */
const expressInterest = async (req, res, next) => {
  try {
    const issueId = objectIdSchema.parse(req.params.id);

    const contributorId = req.auth && req.auth.userId;
    if (!contributorId) {
      throw httpError(401, "UNAUTHENTICATED", "Authentication is required");
    }

    const issue = await Issue.findById(issueId);
    if (!issue) {
      throw httpError(404, "NOT_FOUND", "The requested resource was not found");
    }

    // Verify read access to the issue's project
    await verifyProjectAccess(req.auth, String(issue.projectId));

    // D-D: Interest is only allowed on open issues
    if (issue.status !== "open") {
      throw httpError(409, "CONFLICT", `Cannot express interest in an issue with status '${issue.status}'`);
    }

    // Pre-check for duplicate active interest
    const existing = await IssueInterest.findOne({
      issueId: issue._id,
      contributorId: new mongoose.Types.ObjectId(contributorId),
      status: "active"
    });
    if (existing) {
      throw httpError(409, "CONFLICT", "You have already expressed active interest in this issue");
    }

    let interest;
    try {
      interest = await IssueInterest.create({
        issueId: issue._id,
        contributorId: new mongoose.Types.ObjectId(contributorId),
        projectId: issue.projectId,
        status: "active"
      });
    } catch (createErr) {
      if (createErr && createErr.code === 11000) {
        throw httpError(409, "CONFLICT", "You have already expressed active interest in this issue");
      }
      throw createErr;
    }

    return res.status(201).json({
      success: true,
      data: {
        interest: {
          _id: String(interest._id),
          issueId: String(interest.issueId),
          contributorId: String(interest.contributorId),
          projectId: String(interest.projectId),
          status: interest.status,
          createdAt: interest.createdAt
        }
      },
      meta: {
        requestId: req.requestId || null
      }
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * 4. PATCH /api/issues/:id
 * Maintainer status/assignment/prerequisite update.
 */
const patchIssue = async (req, res, next) => {
  try {
    const issueId = objectIdSchema.parse(req.params.id);
    const validated = patchIssueBodySchema.parse(req.body);

    const allowedKeys = ["status", "assigneeId", "requirements", "prerequisites"];
    const hasAtLeastOne = allowedKeys.some((k) => validated[k] !== undefined);
    if (!hasAtLeastOne) {
      throw httpError(400, "VALIDATION_ERROR", "At least one allowed field must be provided for update");
    }

    const issue = await Issue.findById(issueId);
    if (!issue) {
      throw httpError(404, "NOT_FOUND", "The requested resource was not found");
    }

    // Project maintainer scope check
    await verifyProjectAccess(req.auth, String(issue.projectId), { minRole: "maintainer" });

    let nextStatus = issue.status;
    let shouldClearAssignee = false;
    let targetAssigneeId = issue.assigneeId ? String(issue.assigneeId) : null;

    if (validated.status !== undefined && validated.status !== issue.status) {
      const allowedNext = ISSUE_STATUS_TRANSITIONS[issue.status] || [];
      if (!allowedNext.includes(validated.status)) {
        throw httpError(409, "CONFLICT", `Invalid status transition from '${issue.status}' to '${validated.status}'`);
      }
      nextStatus = validated.status;
    }

    if (nextStatus === "assigned") {
      if (validated.assigneeId !== undefined) {
        targetAssigneeId = validated.assigneeId;
      }
      if (!targetAssigneeId) {
        throw httpError(400, "VALIDATION_ERROR", "Assignee ID is required when transitioning status to assigned");
      }
      const { User } = require("../models/User");
      const user = await User.findById(targetAssigneeId).select("isActive").lean();
      if (!user || user.isActive === false) {
        throw httpError(400, "VALIDATION_ERROR", "Assignee must be an active user");
      }
    } else if (nextStatus === "open") {
      if (validated.assigneeId) {
        throw httpError(400, "VALIDATION_ERROR", "An open issue cannot have an assignee");
      }
      shouldClearAssignee = true;
      targetAssigneeId = null;
    } else if (nextStatus === "closed") {
      if (validated.assigneeId !== undefined) {
        if (validated.assigneeId) {
          const { User } = require("../models/User");
          const user = await User.findById(validated.assigneeId).select("isActive").lean();
          if (!user || user.isActive === false) {
            throw httpError(400, "VALIDATION_ERROR", "Assignee must be an active user");
          }
          targetAssigneeId = validated.assigneeId;
        } else {
          shouldClearAssignee = true;
          targetAssigneeId = null;
        }
      }
    }

    if (issue.status === "open" && validated.status === undefined && validated.assigneeId) {
      throw httpError(400, "VALIDATION_ERROR", "Cannot set an assignee on an open issue without setting status to assigned");
    }

    const updateSet = {};
    if (validated.status !== undefined) updateSet.status = nextStatus;
    if (shouldClearAssignee) {
      updateSet.assigneeId = null;
    } else if (validated.assigneeId !== undefined || (nextStatus === "assigned" && targetAssigneeId)) {
      updateSet.assigneeId = targetAssigneeId ? new mongoose.Types.ObjectId(targetAssigneeId) : null;
    }
    if (validated.requirements !== undefined) updateSet.requirements = validated.requirements;
    if (validated.prerequisites !== undefined) updateSet.prerequisites = validated.prerequisites;

    const updatedIssue = await Issue.findOneAndUpdate(
      { _id: issue._id, status: issue.status },
      { $set: updateSet },
      { new: true, runValidators: true }
    );

    if (!updatedIssue) {
      throw httpError(409, "CONFLICT", "The issue was modified by a concurrent request");
    }

    return res.status(200).json({
      success: true,
      data: {
        issue: serializeMaintainerIssue(updatedIssue)
      },
      meta: {
        requestId: req.requestId || null
      }
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * Service function: Availability check for Onboarding Agent (D1)
 */
async function getIssueAvailability(issueId, auth) {
  if (typeof issueId !== "string" || !/^[a-f\d]{24}$/i.test(issueId)) {
    throw httpError(400, "VALIDATION_ERROR", "A valid issue identifier is required");
  }

  const issue = await Issue.findById(issueId)
    .select("_id projectId status sourceVersion snapshotId")
    .lean();

  if (!issue) {
    throw httpError(404, "NOT_FOUND", "The requested resource was not found");
  }

  await verifyProjectAccess(auth || null, String(issue.projectId));

  const isAssigned = issue.status === "assigned";

  return {
    issueId: String(issue._id),
    status: issue.status,
    assigned: isAssigned,
    sourceVersion: issue.sourceVersion || null,
    snapshotFreshness: {
      known: false,
      snapshotId: issue.snapshotId || null,
      importedAt: null,
      stale: null
    }
  };
}

/**
 * Service function: Atomic open -> assigned update for Contribution Plan review (M6)
 */
async function recordIssueOwnership(issueId, assigneeId) {
  if (typeof issueId !== "string" || !/^[a-f\d]{24}$/i.test(issueId)) {
    throw httpError(400, "VALIDATION_ERROR", "A valid issue identifier is required");
  }
  if (typeof assigneeId !== "string" || !/^[a-f\d]{24}$/i.test(assigneeId)) {
    throw httpError(400, "VALIDATION_ERROR", "A valid assignee identifier is required");
  }

  const { User } = require("../models/User");
  const user = await User.findById(assigneeId).select("isActive").lean();
  if (!user || user.isActive === false) {
    throw httpError(400, "VALIDATION_ERROR", "Assignee must be an active user");
  }

  const updated = await Issue.findOneAndUpdate(
    { _id: issueId, status: "open" },
    { $set: { status: "assigned", assigneeId: new mongoose.Types.ObjectId(assigneeId) } },
    { new: true, runValidators: true }
  );

  if (!updated) {
    throw httpError(409, "CONFLICT", "Issue is not available for assignment");
  }

  return serializeMaintainerIssue(updated);
}

module.exports = {
  listProjects,
  listProjectIssues,
  expressInterest,
  patchIssue,
  getIssueAvailability,
  recordIssueOwnership,
  verifyProjectAccess,
  isApprovedPublicProject
};
