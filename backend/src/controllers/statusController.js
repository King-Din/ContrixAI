"use strict";

const mongoose = require("mongoose");
const { z } = require("zod");
const { httpError } = require("../middleware/roleMiddleware");
const {
  Incident,
  INCIDENT_STATUS,
  INCIDENT_STATUS_TRANSITIONS,
  INCIDENT_SEVERITY,
  INCIDENT_COMPONENTS
} = require("../models/Incident");

// ASSUMPTION(M9->M4): D12 verified maintainers and platform moderators are authorized incident writers
const INCIDENT_WRITE_ROLES = Object.freeze(["maintainer", "moderator"]);

// ASSUMPTION(M9->M8): D13 proposed 7-day stale threshold for repository snapshots
const STALE_THRESHOLD_DAYS = 7;

const DEFAULT_TIMEOUT_MS = 2000;
const INCIDENT_STATUS_VALUES = ["investigating", "identified", "resolved"];

/**
 * Timeout helper bounded by STATUS_CHECK_TIMEOUT_MS (env or default 2000ms).
 * Implemented with AbortController/Promise.race and clearTimeout in finally.
 */
function getTimeoutMs() {
  const envVal = Number(process.env.STATUS_CHECK_TIMEOUT_MS);
  if (Number.isFinite(envVal) && envVal > 0) {
    return Math.min(envVal, 30000);
  }
  return DEFAULT_TIMEOUT_MS;
}

async function withTimeout(asyncFn, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      const err = new Error("STATUS_CHECK_TIMEOUT");
      err.code = "ETIMEDOUT";
      reject(err);
    }, timeoutMs);
  });

  try {
    const fnPromise = typeof asyncFn === "function" ? asyncFn(controller.signal) : asyncFn;
    return await Promise.race([fnPromise, timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}

// Injectable check seam
let checkOverrides = {};
function configureStatusChecks(overrides = {}) {
  checkOverrides = { ...checkOverrides, ...overrides };
}

/**
 * Component Checkers: Output only { status, latencyMs }
 * Values: "healthy" | "unavailable" | "unknown"
 */
async function checkApi() {
  const start = Date.now();
  return { status: "healthy", latencyMs: Math.max(0, Date.now() - start) };
}

async function checkDatabase(signal, timeoutMs) {
  const start = Date.now();
  if (mongoose.connection.readyState !== 1) {
    return { status: "unavailable", latencyMs: Math.max(0, Date.now() - start) };
  }
  try {
    await withTimeout(async () => {
      if (mongoose.connection.db && typeof mongoose.connection.db.command === "function") {
        await mongoose.connection.db.command({ ping: 1 });
      }
    }, timeoutMs);
    return { status: "healthy", latencyMs: Math.max(0, Date.now() - start) };
  } catch {
    return { status: "unavailable", latencyMs: Math.max(0, Date.now() - start) };
  }
}

async function checkModel(signal, timeoutMs) {
  const start = Date.now();
  const rawUrl = process.env.OLLAMA_BASE_URL;
  if (!rawUrl || typeof rawUrl !== "string" || !rawUrl.trim()) {
    return { status: "unknown", latencyMs: null };
  }

  let targetUrl;
  try {
    targetUrl = new URL("/", rawUrl).toString();
  } catch {
    return { status: "unavailable", latencyMs: Math.max(0, Date.now() - start) };
  }

  try {
    const res = await withTimeout(async (abortSignal) => {
      return await fetch(targetUrl, { signal: abortSignal });
    }, timeoutMs);
    const latencyMs = Math.max(0, Date.now() - start);
    return { status: res.ok ? "healthy" : "unavailable", latencyMs };
  } catch {
    // Catch ECONNREFUSED, ETIMEDOUT, AbortError, etc.
    // NEVER leak host, port, credentials, or error text
    return { status: "unavailable", latencyMs: Math.max(0, Date.now() - start) };
  }
}

// ASSUMPTION(M9->D1): D1 owns DocumentChunk and the search index.
// If no checker is injected and no verified method exists, return "unknown".
async function checkRetrieval(signal, timeoutMs) {
  const start = Date.now();
  const indexName = process.env.VECTOR_INDEX_NAME;
  if (!indexName) {
    return { status: "unknown", latencyMs: null };
  }

  try {
    const chunkModel = mongoose.models.DocumentChunk || mongoose.models.Document;
    if (chunkModel && chunkModel.collection && typeof chunkModel.collection.listSearchIndexes === "function") {
      const cursor = await withTimeout(async () => {
        return await chunkModel.collection.listSearchIndexes(indexName).toArray();
      }, timeoutMs);
      const latencyMs = Math.max(0, Date.now() - start);
      return { status: cursor && cursor.length > 0 ? "healthy" : "unavailable", latencyMs };
    }
  } catch {
    return { status: "unavailable", latencyMs: Math.max(0, Date.now() - start) };
  }

  return { status: "unknown", latencyMs: null };
}

/**
 * Reusable component checks runner (for M9 getStatus and M1 /api/health)
 */
async function runComponentChecks() {
  const timeoutMs = getTimeoutMs();

  const apiChecker = checkOverrides.checkApi || checkApi;
  const dbChecker = checkOverrides.checkDatabase || checkDatabase;
  const modelChecker = checkOverrides.checkModel || checkModel;
  const retrievalChecker = checkOverrides.checkRetrieval || checkRetrieval;

  const normalizeResult = (res, fallbackStatus = "unavailable") => {
    if (res.status === "fulfilled" && res.value) {
      if (typeof res.value === "string") {
        return { status: res.value, latencyMs: 0 };
      }
      return {
        status: res.value.status || fallbackStatus,
        latencyMs: typeof res.value.latencyMs === "number" ? res.value.latencyMs : null
      };
    }
    return { status: fallbackStatus, latencyMs: null };
  };

  const results = await Promise.allSettled([
    apiChecker(),
    dbChecker(null, timeoutMs),
    modelChecker(null, timeoutMs),
    retrievalChecker(null, timeoutMs)
  ]);

  const components = {
    api: normalizeResult(results[0], "unavailable"),
    database: normalizeResult(results[1], "unavailable"),
    model: normalizeResult(results[2], "unavailable"),
    retrieval: normalizeResult(results[3], "unknown")
  };

  const overall = computeOverallStatus(components);
  return { components, overall };
}

/**
 * Overall status (computed in pure code on every request)
 * ASSUMPTION(M9->M1/M8):
 * - "unavailable" if api or database is not healthy
 * - else "degraded" if model or retrieval is unavailable or unknown
 * - else "healthy"
 * - Stale snapshot is a visible warning only and does not change overall status.
 */
function computeOverallStatus(components) {
  if (!components) return "unavailable";
  const apiStatus = components.api && components.api.status;
  const dbStatus = components.database && components.database.status;
  if (apiStatus !== "healthy" || dbStatus !== "healthy") {
    return "unavailable";
  }

  const modelStatus = components.model && components.model.status;
  const retrievalStatus = components.retrieval && components.retrieval.status;
  if (modelStatus !== "healthy" || retrievalStatus !== "healthy") {
    return "degraded";
  }

  return "healthy";
}

/**
 * Snapshot freshness helper (authoritative, never guessed)
 * ASSUMPTION(M9->D3/M8): Lazily loads ../models/RepositorySnapshot. Fails soft if not present.
 */
async function defaultLoadLatestSnapshot() {
  try {
    let Snap = mongoose.models.RepositorySnapshot;
    if (!Snap) {
      try {
        const m = require("../models/RepositorySnapshot");
        Snap = m.RepositorySnapshot || m.default || m;
      } catch {
        Snap = null;
      }
    }
    if (!Snap || typeof Snap.findOne !== "function") return null;

    // Only consider PUBLIC, usable snapshots (visibility "public", status not failed/revoked)
    return await Snap.findOne({
      visibility: "public",
      status: { $nin: ["failed", "revoked"] }
    })
      .sort({ importedAt: -1, createdAt: -1 })
      .lean();
  } catch {
    return null;
  }
}

async function getSnapshotFreshness() {
  try {
    const loader = checkOverrides.loadLatestSnapshot || defaultLoadLatestSnapshot;
    const snapshot = await loader();
    if (!snapshot) {
      return { version: null, importedAt: null, stale: null };
    }

    // Fail closed if private or failed/revoked
    if (snapshot.visibility !== "public" || ["failed", "revoked"].includes(snapshot.status)) {
      return { version: null, importedAt: null, stale: null };
    }

    const importedAt = snapshot.importedAt || snapshot.createdAt || null;
    let stale = null;
    if (importedAt) {
      const importedTime = new Date(importedAt).getTime();
      if (Number.isFinite(importedTime)) {
        stale = Date.now() - importedTime > STALE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;
      }
    }

    return {
      version: snapshot.version !== undefined ? snapshot.version : null,
      importedAt: importedAt ? new Date(importedAt).toISOString() : null,
      stale
    };
  } catch {
    return { version: null, importedAt: null, stale: null };
  }
}

/**
 * Serializer for public/authorized incident output
 */
function toPublicIncident(doc, isAuthorizedWriter = false) {
  const out = {
    _id: String(doc._id),
    title: doc.title,
    severity: doc.severity,
    component: doc.component,
    status: doc.status,
    createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : null,
    updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : null
  };
  if (doc.resolvedAt) {
    out.resolvedAt = new Date(doc.resolvedAt).toISOString();
  }
  if (isAuthorizedWriter && doc.createdBy) {
    out.createdBy = String(doc.createdBy);
  }
  return out;
}

/**
 * Zod Schemas (.strict() on bodies/params/query)
 */
const listIncidentsQuerySchema = z
  .object({
    status: z.enum(INCIDENT_STATUS_VALUES).optional(),
    limit: z.coerce.number().int().min(1).default(20)
  })
  .strict();

const createIncidentSchema = z
  .object({
    title: z
      .string({ required_error: "Title is required" })
      .trim()
      .min(3, "Title must be at least 3 characters")
      .max(200, "Title must not exceed 200 characters"),
    severity: z.enum(INCIDENT_SEVERITY, {
      errorMap: () => ({ message: `Severity must be one of: ${INCIDENT_SEVERITY.join(", ")}` })
    }),
    component: z.enum(INCIDENT_COMPONENTS, {
      errorMap: () => ({ message: `Component must be one of: ${INCIDENT_COMPONENTS.join(", ")}` })
    })
  })
  .strict();

const updateIncidentSchema = z
  .object({
    status: z.enum(INCIDENT_STATUS_VALUES, {
      errorMap: () => ({ message: `Status must be one of: ${INCIDENT_STATUS_VALUES.join(", ")}` })
    })
  })
  .strict();

/**
 * 1. GET /api/status (public)
 */
const getStatus = async (req, res, next) => {
  try {
    // Client input ignored for status
    const { components, overall } = await runComponentChecks();
    const snapshot = await getSnapshotFreshness();

    let unresolvedIncidents = [];
    try {
      if (mongoose.connection.readyState === 1 && Incident && typeof Incident.find === "function") {
        const docs = await Incident.find({ status: { $ne: "resolved" } })
          .sort({ createdAt: -1 })
          .limit(10)
          .lean();
        unresolvedIncidents = docs.map((doc) => toPublicIncident(doc, false));
      }
    } catch {
      unresolvedIncidents = [];
    }

    // ASSUMPTION(M9->M1): HTTP 503 if overall status is "unavailable", 200 otherwise
    const httpStatus = overall === "unavailable" ? 503 : 200;
    const success = overall !== "unavailable";

    const data = {
      status: overall,
      service: "contrixai-api",
      checkedAt: new Date().toISOString(),
      components,
      snapshot,
      incidents: unresolvedIncidents
    };

    const meta = {
      requestId: req.requestId || null
    };
    if (snapshot && snapshot.version !== null && snapshot.version !== undefined) {
      meta.snapshotVersion = snapshot.version;
    }

    return res.status(httpStatus).json({
      success,
      data,
      meta
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * 2. GET /api/incidents (public via optionalProtect)
 */
const listIncidents = async (req, res, next) => {
  try {
    const parsedQuery = listIncidentsQuerySchema.parse(req.query);
    const limit = Math.min(parsedQuery.limit, 50);

    const filter = {};
    if (parsedQuery.status) {
      filter.status = parsedQuery.status;
    }

    const docs = await Incident.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    const isAuthorizedWriter = Boolean(
      req.auth &&
      req.auth.userId &&
      INCIDENT_WRITE_ROLES.includes(req.auth.role) &&
      (req.auth.role !== "maintainer" || req.auth.maintainerVerified === true)
    );

    const data = docs.map((doc) => toPublicIncident(doc, isAuthorizedWriter));

    return res.status(200).json({
      success: true,
      data: { incidents: data },
      meta: {
        requestId: req.requestId || null
      }
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * 3. POST /api/incidents (protect + authorize(...INCIDENT_WRITE_ROLES))
 */
const createIncident = async (req, res, next) => {
  try {
    if (!req.auth || !req.auth.userId) {
      return next(httpError(401, "UNAUTHENTICATED", "Authentication is required"));
    }

    const validated = createIncidentSchema.parse(req.body);

    const incident = await Incident.create({
      title: validated.title,
      severity: validated.severity,
      component: validated.component,
      status: "investigating",
      createdBy: req.auth.userId
    });

    return res.status(201).json({
      success: true,
      data: {
        incident: toPublicIncident(incident, true)
      },
      meta: {
        requestId: req.requestId || null
      }
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * 4. PATCH /api/incidents/:id (protect + authorize(...INCIDENT_WRITE_ROLES))
 */
const updateIncident = async (req, res, next) => {
  try {
    if (!req.auth || !req.auth.userId) {
      return next(httpError(401, "UNAUTHENTICATED", "Authentication is required"));
    }

    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return next(httpError(404, "NOT_FOUND", "The requested resource was not found"));
    }

    const validated = updateIncidentSchema.parse(req.body);

    const incident = await Incident.findById(id);
    if (!incident) {
      return next(httpError(404, "NOT_FOUND", "The requested resource was not found"));
    }

    // Disallowed or same-state transition check
    const allowedNext = INCIDENT_STATUS_TRANSITIONS[incident.status] || [];
    if (validated.status === incident.status || !allowedNext.includes(validated.status)) {
      return next(
        httpError(409, "CONFLICT", `Invalid status transition from '${incident.status}' to '${validated.status}'`)
      );
    }

    const updateSet = { status: validated.status };
    if (validated.status === "resolved") {
      updateSet.resolvedAt = new Date();
    }

    const updated = await Incident.findOneAndUpdate(
      { _id: incident._id, status: incident.status },
      { $set: updateSet },
      { new: true, runValidators: true }
    );

    if (!updated) {
      return next(httpError(409, "CONFLICT", "The incident was modified concurrently; reload and retry"));
    }

    return res.status(200).json({
      success: true,
      data: {
        incident: toPublicIncident(updated, true)
      },
      meta: {
        requestId: req.requestId || null
      }
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getStatus,
  listIncidents,
  createIncident,
  updateIncident,
  computeOverallStatus,
  withTimeout,
  configureStatusChecks,
  runComponentChecks,
  getSnapshotFreshness,
  INCIDENT_WRITE_ROLES
};
