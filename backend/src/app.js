"use strict";

const express = require("express");
const path = require("node:path");
const fs = require("node:fs");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const cookieParser = require("cookie-parser");
const session = require("express-session");

const requestId = require("./middleware/requestId");
const { errorMiddleware } = require("./middleware/errorMiddleware");
const { csrfProtect } = require("./middleware/authMiddleware");
const healthRoutes = require("./routes/healthRoutes");
const authRoutes = require("./routes/authRoutes");
const planRoutes = require("./routes/planRoutes");
const ticketRoutes = require("./routes/ticketRoutes");
const statusRoutes = require("./routes/statusRoutes");
const documentRoutes = require("./routes/documentRoutes");
const helpRoutes = require("./routes/helpRoutes");
const agentRoutes = require("./routes/agentRoutes");
const { Project } = require("./models/Project");
const { Membership } = require("./models/Membership");

const app = express();

app.disable("x-powered-by");
app.use(requestId);
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: false
  })
);

const allowedOrigins = (process.env.CORS_ORIGINS || "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      const error = new Error("Origin is not allowed by CORS");
      error.status = 403;
      error.code = "FORBIDDEN";
      return callback(error);
    },
    credentials: true
  })
);

app.use(cookieParser(process.env.SESSION_SECRET || "contrixai_session_secret"));

const sessionSecret = process.env.SESSION_SECRET || "contrixai_session_secret";
const sessionTtlMinutes = Number(process.env.SESSION_TTL_MINUTES) || 60;

app.use(
  session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: sessionTtlMinutes * 60 * 1000
    }
  })
);

app.use(express.json({ limit: process.env.JSON_LIMIT || "100kb" }));

app.use(
  "/api",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler(req, res) {
      res.status(429).json({
        success: false,
        message: "Too many requests. Please try again later.",
        code: "RATE_LIMITED",
        requestId: req.requestId || null
      });
    }
  })
);

// M4/M5 Project Access Checker for authGuards
app.locals.checkProjectAccess = async ({ userId, projectId, roles, userRole }) => {
  if (userRole === "moderator" || userRole === "admin") return true;
  const project = await Project.findById(projectId).lean().catch(() => null);
  if (!project) return false;
  const isPublic = project.visibility === "public" && (project.approved === true || project.status === "approved");
  if (isPublic && (!roles || !roles.length || roles.includes("contributor"))) {
    return true;
  }
  const membership = await Membership.findOne({ userId, projectId }).lean().catch(() => null);
  if (membership && membership.status === "active") {
    if (!roles || !roles.length) return true;
    return roles.includes(membership.role);
  }
  return false;
};

// Serve frontend assets from frontend folder (and fallback to public)
const frontendDir = path.resolve(__dirname, "../../frontend");
const publicDir = path.resolve(__dirname, "../../public");

if (fs.existsSync(frontendDir)) {
  app.use(express.static(frontendDir, { index: false }));
}
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir, { index: false }));
}

const getPrimaryHtml = () => {
  const feHtml = path.join(frontendDir, "index.html");
  if (fs.existsSync(feHtml)) {
    return feHtml;
  }
  return path.join(publicDir, "index.html");
};

app.get("/", (req, res) => {
  if (req.headers.accept && req.headers.accept.includes("text/html") && !req.headers.accept.includes("application/json")) {
    return res.sendFile(getPrimaryHtml());
  }
  res.json({
    success: true,
    data: { name: "ContrixAI API", status: "running" },
    meta: { requestId: req.requestId }
  });
});

app.get("/app", (req, res) => {
  res.sendFile(getPrimaryHtml());
});

app.get("/demo", (req, res) => {
  res.sendFile(getPrimaryHtml());
});

// CSRF protection for cookie-authenticated API mutations.
app.use("/api", csrfProtect);

// Core and Domain Route Mounts
app.use("/api/health", healthRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/contribution-plans", planRoutes);
app.use("/api", ticketRoutes);
app.use("/api", statusRoutes);
app.use("/api", helpRoutes);
app.use("/api", agentRoutes);
app.use("/api/projects/:projectId/docs", documentRoutes);

// SPA fallback for HTML requests to routes like /login, /contributor, /maintainer, /moderator
app.get("*", (req, res, next) => {
  if (req.headers.accept && req.headers.accept.includes("text/html") && !req.url.startsWith("/api")) {
    return res.sendFile(getPrimaryHtml());
  }
  return next();
});

// Unknown endpoint 404 handler in standard JSON envelope
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "The requested endpoint was not found",
    code: "NOT_FOUND",
    requestId: req.requestId || null
  });
});

// Central error handler: mounted strictly LAST
app.use(errorMiddleware);

module.exports = app;
