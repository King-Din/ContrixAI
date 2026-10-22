"use strict";

const mongoose = require("mongoose");
const { z } = require("zod");
const { HelpArticle } = require("../models/HelpArticle");
const { DocumentChunk } = require("../models/DocumentChunk");
const { RepositorySnapshot } = require("../models/RepositorySnapshot");
const { retrieveDocuments, getSnapshotStatus } = require("../services/documentKnowledgeService");
const { assertProjectAccess, httpError } = require("../middleware/roleMiddleware");

const searchDocQuerySchema = z.object({
  q: z.string({ required_error: "Query parameter 'q' is required" }).trim().min(1).max(300),
  limit: z.coerce.number().int().min(1).max(10).default(5),
  snapshotId: z.string().trim().max(120).optional()
});

const staleDocBodySchema = z.object({
  stale: z.boolean().default(true),
  reason: z.string().trim().max(500).optional()
});

async function searchDocuments(req, res, next) {
  try {
    const { projectId } = req.params;
    if (!mongoose.isValidObjectId(projectId)) {
      throw httpError(400, "VALIDATION_ERROR", "Invalid project identifier");
    }

    const queryParsed = searchDocQuerySchema.safeParse(req.query);
    if (!queryParsed.success) {
      throw httpError(400, "VALIDATION_ERROR", "Search query validation failed: " + queryParsed.error.issues.map(i => i.message).join(", "));
    }

    // Access check: assert project access (anonymous allowed for public approved project)
    await assertProjectAccess(req.auth || null, projectId);

    const { q, limit, snapshotId } = queryParsed.data;
    const authContext = req.auth
      ? { ...req.auth, projectAccess: true }
      : { role: "guest", projectAccess: false };

    const result = await retrieveDocuments({
      projectId,
      auth: authContext,
      question: q,
      snapshotId,
      limit
    });

    return res.status(200).json({
      success: true,
      data: result,
      meta: {
        requestId: req.requestId || null,
        snapshotVersion: result.snapshotVersions ? result.snapshotVersions[0] : null
      }
    });
  } catch (err) {
    return next(err);
  }
}

async function listDocuments(req, res, next) {
  try {
    const { projectId } = req.params;
    if (!mongoose.isValidObjectId(projectId)) {
      throw httpError(400, "VALIDATION_ERROR", "Invalid project identifier");
    }

    const { project, membership } = await assertProjectAccess(req.auth || null, projectId);
    const isMember = Boolean(membership && membership.status === "active");

    const visibilities = isMember || (req.auth && ["maintainer", "moderator"].includes(req.auth.role))
      ? ["public", "private"]
      : ["public"];

    const chunks = await DocumentChunk.find({
      projectId,
      visibility: { $in: visibilities }
    })
      .select("chunkId path heading visibility snapshotId importedAt")
      .limit(100)
      .lean();

    return res.status(200).json({
      success: true,
      data: {
        documents: chunks,
        count: chunks.length
      },
      meta: { requestId: req.requestId || null }
    });
  } catch (err) {
    return next(err);
  }
}

async function flagStaleInstruction(req, res, next) {
  try {
    const { projectId, id } = req.params;
    if (!mongoose.isValidObjectId(projectId)) {
      throw httpError(400, "VALIDATION_ERROR", "Invalid project identifier");
    }

    // Verified maintainer with project scope
    await assertProjectAccess(req.auth, projectId, { minRole: "maintainer" });

    const parsed = staleDocBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw httpError(400, "VALIDATION_ERROR", "Invalid stale flag payload");
    }

    let article = await HelpArticle.findOne({
      projectId,
      $or: [{ chunkId: id }, { _id: mongoose.isValidObjectId(id) ? id : null }]
    });

    if (!article) {
      const chunk = await DocumentChunk.findOne({
        projectId,
        $or: [{ chunkId: id }, { _id: mongoose.isValidObjectId(id) ? id : null }]
      });
      if (!chunk) {
        throw httpError(404, "NOT_FOUND", "Document not found");
      }
      article = new HelpArticle({
        projectId,
        snapshotId: chunk.snapshotId,
        chunkId: chunk.chunkId,
        path: chunk.path,
        heading: chunk.heading,
        content: chunk.content,
        visibility: chunk.visibility
      });
    }

    article.status = parsed.data.stale ? "stale" : "published";
    if (parsed.data.reason) {
      article.staleReason = parsed.data.reason;
    }
    await article.save();

    return res.status(200).json({
      success: true,
      data: {
        article: {
          id: article._id,
          chunkId: article.chunkId,
          status: article.status,
          staleReason: article.staleReason
        }
      },
      meta: { requestId: req.requestId || null }
    });
  } catch (err) {
    return next(err);
  }
}

async function listHelpArticles(req, res, next) {
  try {
    const { projectId } = req.params;
    if (!mongoose.isValidObjectId(projectId)) {
      throw httpError(400, "VALIDATION_ERROR", "Invalid project identifier");
    }

    await assertProjectAccess(req.auth || null, projectId);
    const articles = await HelpArticle.find({ projectId, visibility: "public" })
      .select("path heading status staleReason tags createdAt")
      .lean();

    return res.status(200).json({
      success: true,
      data: { articles },
      meta: { requestId: req.requestId || null }
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  searchDocuments,
  listDocuments,
  flagStaleInstruction,
  listHelpArticles
};
