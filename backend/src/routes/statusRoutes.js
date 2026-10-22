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

router.post("/demo/seed", async (req, res, next) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(403).json({ success: false, code: "FORBIDDEN", message: "Seeding disabled in production" });
  }
  try {
    const { seed } = require("../seed/seedAdapter");
    const { seedFixtureManifest } = require("../seed/seedData");
    const result = await seed({
      manifest: seedFixtureManifest,
      env: {
        ...process.env,
        SEED_CONFIRM: "YES",
        SEED_DB_NAME: process.env.SEED_DB_NAME || "contrixai_demo",
        SEED_CONTRIBUTOR_EMAIL: process.env.SEED_CONTRIBUTOR_EMAIL || "contributor@example.test",
        SEED_MAINTAINER_EMAIL: process.env.SEED_MAINTAINER_EMAIL || "maintainer@example.test",
        SEED_MODERATOR_EMAIL: process.env.SEED_MODERATOR_EMAIL || "moderator@example.test",
        SEED_CONTRIBUTOR_PASSWORD: process.env.SEED_CONTRIBUTOR_PASSWORD || "demo123456",
        SEED_MAINTAINER_PASSWORD: process.env.SEED_MAINTAINER_PASSWORD || "demo123456",
        SEED_MODERATOR_PASSWORD: process.env.SEED_MODERATOR_PASSWORD || "demo123456"
      }
    });
    return res.status(200).json({ success: true, data: result, meta: { requestId: req.requestId || null } });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
