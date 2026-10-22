"use strict";
const express = require("express");
const { loadAuthContext, requireAuth, requireVerifiedMaintainer, requireProjectAccess } = require("../middleware/authGuards");
const { importProjectDocs, searchProjectDocs, listProjectSnapshots } = require("../controllers/documentController");
const router = express.Router({ mergeParams: true });
// M4/M5 integration contract: app.locals.checkProjectAccess must be configured for project-scoped access.
router.post("/import", loadAuthContext, requireAuth, requireVerifiedMaintainer, requireProjectAccess({ getProjectId: (req) => req.params.projectId, roles: ["maintainer", "moderator", "admin"] }), importProjectDocs);
router.post("/search", loadAuthContext, requireAuth, requireProjectAccess({ getProjectId: (req) => req.params.projectId, roles: ["contributor", "maintainer", "moderator", "admin"] }), searchProjectDocs);
router.get("/snapshots", loadAuthContext, requireAuth, requireProjectAccess({ getProjectId: (req) => req.params.projectId, roles: ["contributor", "maintainer", "moderator", "admin"] }), listProjectSnapshots);
module.exports = router;
