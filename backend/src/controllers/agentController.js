"use strict";

const { z } = require("zod");
const mongoose = require("mongoose");
const { runOnboardingWorkflow } = require("../services/onboardingAgentService");
const { generateRAGAnswer } = require("../services/aiService");
const { retrieveDocuments } = require("../services/documentKnowledgeService");
const { assertProjectAccess, httpError } = require("../middleware/roleMiddleware");
const { User } = require("../models/User");

const onboardingAgentSchema = z.object({
  projectId: z.string({ required_error: "projectId is required" }).trim().min(1),
  skills: z.array(z.string().trim().max(40)).max(30).optional(),
  interests: z.array(z.string().trim().max(40)).max(20).optional(),
  hoursPerWeek: z.number().min(0).max(40).optional()
});

const askDocsSchema = z.object({
  projectId: z.string({ required_error: "projectId is required" }).trim().min(1),
  question: z.string({ required_error: "question is required" }).trim().min(1).max(1000),
  snapshotId: z.string().trim().max(120).optional(),
  limit: z.number().int().min(1).max(10).default(5)
});

async function runAgent(req, res, next) {
  try {
    const parsed = onboardingAgentSchema.safeParse(req.body);
    if (!parsed.success) {
      throw httpError(400, "VALIDATION_ERROR", "Invalid payload: " + parsed.error.issues.map((i) => i.message).join(", "));
    }

    if (!req.auth || !req.auth.userId) {
      throw httpError(401, "UNAUTHENTICATED", "Authentication is required");
    }

    const user = await User.findById(req.auth.userId).lean();
    if (!user || user.isActive === false) {
      throw httpError(401, "UNAUTHENTICATED", "User not active or found");
    }

    const { projectId, skills, interests, hoursPerWeek } = parsed.data;

    const result = await runOnboardingWorkflow({
      user,
      projectId,
      skills: skills || user.skills || [],
      interests: interests || user.interests || [],
      hoursPerWeek: hoursPerWeek || user.availability?.hoursPerWeek || 5
    });

    return res.status(200).json({
      success: true,
      data: result.data,
      meta: { requestId: req.requestId || null }
    });
  } catch (err) {
    return next(err);
  }
}

async function askDocs(req, res, next) {
  try {
    const parsed = askDocsSchema.safeParse(req.body);
    if (!parsed.success) {
      throw httpError(400, "VALIDATION_ERROR", "Invalid payload: " + parsed.error.issues.map((i) => i.message).join(", "));
    }

    const { projectId, question, snapshotId, limit } = parsed.data;
    await assertProjectAccess(req.auth || null, projectId);

    // Retrieve authorized document excerpts
    const authContext = req.auth
      ? { ...req.auth, projectAccess: true }
      : { role: "guest", projectAccess: false };

    const retrievalResult = await retrieveDocuments({
      projectId,
      auth: authContext,
      question,
      snapshotId,
      limit
    });

    if (retrievalResult.status === "no_evidence" || !retrievalResult.references || !retrievalResult.references.length) {
      return res.status(200).json({
        success: true,
        data: {
          status: "no_evidence",
          answer: "No adequate documentation evidence was found in the authorized repository snapshot. Please check the documentation repository or ask a project maintainer.",
          citations: [],
          snapshotVersion: retrievalResult.snapshotVersions ? retrievalResult.snapshotVersions[0] : null
        },
        meta: { requestId: req.requestId || null }
      });
    }

    // Pass retrieved excerpts to constrained RAG generator
    const ragResult = await generateRAGAnswer({
      question,
      excerpts: retrievalResult.references,
      snapshotId,
      snapshotVersion: retrievalResult.snapshotVersions ? retrievalResult.snapshotVersions[0] : "v1"
    });

    return res.status(200).json({
      success: true,
      data: ragResult,
      meta: {
        requestId: req.requestId || null,
        snapshotVersion: ragResult.snapshotVersion
      }
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  runAgent,
  askDocs
};
