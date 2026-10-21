"use strict";

const express = require("express");
const { protect, optionalProtect } = require("../middleware/authMiddleware");
const { authorize } = require("../middleware/roleMiddleware");
const {
  getStatus,
  listIncidents,
  createIncident,
  updateIncident,
  INCIDENT_WRITE_ROLES
} = require("../controllers/statusController");

const router = express.Router();

/**
 * M9 Route Surface:
 * Mounted by M1 at /api
 *
 * 1. GET /status
 *    Public health and dependency status (no auth)
 * 2. GET /incidents
 *    optionalProtect (createdBy serialized only for authorized incident writers)
 * 3. POST /incidents
 *    protect, authorize(...INCIDENT_WRITE_ROLES)
 * 4. PATCH /incidents/:id
 *    protect, authorize(...INCIDENT_WRITE_ROLES)
 */

router.get("/status", getStatus);
router.get("/incidents", optionalProtect, listIncidents);
router.post("/incidents", protect, authorize(...INCIDENT_WRITE_ROLES), createIncident);
router.patch("/incidents/:id", protect, authorize(...INCIDENT_WRITE_ROLES), updateIncident);

module.exports = router;
