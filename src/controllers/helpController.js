
"use strict";

const { z } = require("zod");
const { httpError, assertProjectAccess } = require("../middleware/roleMiddleware");

const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(300),
  limit: z.coerce.number().int().min(1).max(10).default(5)
});

/**
 * M8: Documentation search controller.
 * Retrieval must be connected to the agreed D1 interface before use.
 */
async function searchProjectDocuments(req, res, next) {
  try {
    const parsed = searchQuerySchema.safeParse(req.query);

    if (!parsed.success) {
      throw httpError(400, "VALIDATION_ERROR", "Invalid documentation search query");
    }

    const { projectId } = req.params;

    // Check project access before any retrieval is attempted.
    await assertProjectAccess(req.auth || null, projectId);

    // Do not return fabricated evidence or citations.
    // Connect the agreed D1 retrieval interface here.
    return res.status(200).json({
      success: true,
      data: {
        results: [],
        outcome: "NO_EVIDENCE"
      },
      meta: {
        requestId: req.requestId || null
      }
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  searchProjectDocuments
};
