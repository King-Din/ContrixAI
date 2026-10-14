const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const requestId = require("./middleware/requestId");
const errorMiddleware = require("./middleware/errorMiddleware");
const healthRoutes = require("./routes/healthRoutes");

const app = express();

app.disable("x-powered-by");
app.use(requestId);
app.use(helmet());

const allowedOrigins = (process.env.CORS_ORIGINS || "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    // Requests without Origin include curl and server-to-server calls.
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origin is not allowed by CORS"));
  },
  credentials: true
}));

app.use(express.json({ limit: process.env.JSON_LIMIT || "100kb" }));

app.use("/api", rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests. Please try again later.",
    code: "RATE_LIMITED"
  }
}));

app.get("/", (req, res) => {
  res.json({
    success: true,
    data: { name: "ContrixAI API", status: "running" },
    meta: { requestId: req.requestId }
  });
});

app.use("/api/health", healthRoutes);

// M1 integration TODO:
// Mount the finalized M2–M10 routers here once their owners publish stable
// exports/contracts. Do not create or change another member's business logic.
// Examples from the blueprint: auth, issues, contribution plans, help/docs,
// incidents and status. Update README/integration-checklist.md during merges.

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "The requested endpoint was not found",
    code: "NOT_FOUND",
    requestId: req.requestId
  });
});

// Must remain last. Replace with M10's errorMiddleware during integration.
// Error middleware must remain last.
app.use(errorMiddleware);

module.exports = app;
