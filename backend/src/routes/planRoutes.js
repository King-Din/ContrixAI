"use strict";

const express = require("express");
const {
  createPlan,
  getPlan,
  updatePlan,
  reviewPlan,
  listPlans
} = require("../controllers/planController");
const { loadAuthContext, requireAuth } = require("../middleware/authGuards");

const router = express.Router();

router.get("/", loadAuthContext, requireAuth, listPlans);
router.post("/", loadAuthContext, requireAuth, createPlan);
router.get("/:id", loadAuthContext, requireAuth, getPlan);
router.patch("/:id", loadAuthContext, requireAuth, updatePlan);
router.post("/:id/review", loadAuthContext, requireAuth, reviewPlan);

module.exports = router;
