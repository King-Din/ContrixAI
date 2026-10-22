"use strict";

const express = require("express");
const { protect, optionalProtect } = require("../middleware/authMiddleware");
const { authorize } = require("../middleware/roleMiddleware");
const {
  searchDocuments,
  listDocuments,
  flagStaleInstruction,
  listHelpArticles
} = require("../controllers/helpController");
const { importProjectDocs } = require("../controllers/documentController");

const router = express.Router();

/**
 * M8 / Knowledge Base Routes:
 * Mounted at /api
 *
 * GET   /projects/:projectId/documents/search
 * GET   /projects/:projectId/documents
 * PATCH /projects/:projectId/documents/:id/stale
 * GET   /projects/:projectId/help-articles
 * POST  /projects/:projectId/imports  (or /projects/:id/imports)
 */

router.get("/projects/:projectId/documents/search", optionalProtect, searchDocuments);
router.get("/projects/:projectId/documents", optionalProtect, listDocuments);
router.patch("/projects/:projectId/documents/:id/stale", protect, authorize("maintainer"), flagStaleInstruction);
router.get("/projects/:projectId/help-articles", optionalProtect, listHelpArticles);
router.post("/projects/:projectId/imports", protect, authorize("maintainer"), importProjectDocs);
router.post("/projects/:id/imports", protect, authorize("maintainer"), importProjectDocs);

module.exports = router;
