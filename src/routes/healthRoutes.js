const express = require("express");
const mongoose = require("mongoose");

const router = express.Router();

// Bootstrap health check. M9 should extend/replace this with the agreed
// healthy/degraded/unavailable status and snapshot/model freshness details.
router.get("/", (req, res) => {
  const databaseConnected = mongoose.connection.readyState === 1;

  res.status(databaseConnected ? 200 : 503).json({
    success: true,
    data: {
      status: databaseConnected ? "healthy" : "degraded",
      service: "contrixai-api",
      database: databaseConnected ? "connected" : "disconnected"
    },
    meta: { requestId: req.requestId }
  });
});

module.exports = router;
