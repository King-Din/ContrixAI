"use strict";

const express = require("express");
const { protect, optionalProtect } = require("../middleware/authMiddleware");
const { authorize } = require("../middleware/roleMiddleware");
const { runAgent, askDocs } = require("../controllers/agentController");

const router = express.Router();

/**
 * AI & Agent Routes
 * POST /api/onboarding-agent  (Authenticated contributor)
 * POST /api/ask-docs          (Public/authenticated project docs Q&A)
 * POST /api/contributor-chat  (Alias for docs RAG chat)
 */

router.post("/onboarding-agent", protect, authorize("contributor"), runAgent);
router.post("/ask-docs", optionalProtect, askDocs);
router.post("/contributor-chat", optionalProtect, askDocs);

module.exports = router;
