"use strict";

const express = require("express");
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
<<<<<<< HEAD
const documentRoutes = require("./routes/documentRoutes");
=======
>>>>>>> upstream/main

const app = express();

app.disable("x-powered-by");
app.use(requestId);
app.use(helmet());

const allowedOrigins = (process.env.CORS_ORIGINS || "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // Requests without Origin include curl and server-to-server calls.
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

app.get("/", (req, res) => {
  res.json({
    success: true,
    data: { name: "ContrixAI API", status: "running" },
    meta: { requestId: req.requestId }
  });
});

// CSRF protection for cookie-authenticated API mutations.
app.use("/api", csrfProtect);

// Core and Domain Route Mounts
app.use("/api/health", healthRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/contribution-plans", planRoutes);
<<<<<<< HEAD
app.use("/api/projects/:projectId/docs", documentRoutes);
=======
>>>>>>> upstream/main

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
