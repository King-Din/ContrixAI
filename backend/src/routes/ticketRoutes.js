"use strict";

const express = require("express");
const { protect, optionalProtect } = require("../middleware/authMiddleware");
const { authorize } = require("../middleware/roleMiddleware");
const {
  listProjects,
  listProjectIssues,
  expressInterest,
  patchIssue,
  verifyProject
} = require("../controllers/ticketController");

const router = express.Router();

/**
 * M7 Route Surface:
 * Mounted by M1 at /api
 *
 * 1. GET /projects
 *    optionalProtect
 * 2. GET /projects/:projectId/issues and GET /projects/:id/issues
 *    optionalProtect (scoped via assertProjectAccess in controller)
 * 3. POST /issues/:id/interest
 *    protect, authorize("contributor")
 * 4. PATCH /issues/:id
 *    protect, authorize("maintainer")
 * 5. PATCH /projects/:id/verification
 *    protect, authorize("moderator")
 */

router.get("/projects", optionalProtect, listProjects);
router.get("/projects/:projectId/issues", optionalProtect, listProjectIssues);
router.get("/projects/:id/issues", optionalProtect, (req, res, next) => {
  req.params.projectId = req.params.id;
  return listProjectIssues(req, res, next);
});
router.post("/issues/:id/interest", protect, authorize("contributor"), expressInterest);
router.patch("/issues/:id", protect, authorize("maintainer"), patchIssue);
router.patch("/projects/:id/verification", protect, authorize("moderator"), verifyProject);

module.exports = router;
