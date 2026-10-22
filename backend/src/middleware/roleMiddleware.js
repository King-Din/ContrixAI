"use strict";

/*
 * AI TOOL AUTHORIZATION CHECKLIST (M4). Identity always comes from the server
 * session (req.auth), never from model-supplied arguments. The model never
 * chooses project, snapshot, collection or tool name. Checks run inside each
 * tool, not only on Express routes.
 */

const mongoose = require("mongoose");

const ROLES = Object.freeze(["contributor", "maintainer", "moderator"]);
const httpError = (status, code, message) =>
  Object.assign(new Error(message), { status, code });
const notFound = () => httpError(404, "NOT_FOUND", "The requested resource was not found");
const notConfigured = () =>
  httpError(500, "SERVER_ERROR", "Project access is not configured");

// Resolve a model lazily. Returns null if the file does not exist yet.
function loadModel(path, name) {
  try {
    const m = require(path);
    return m[name] || m.default || m;
  } catch {
    return null;
  }
}

const defaultDeps = {
  loadProject: async (id) => {
    const Project = loadModel("../models/Project", "Project");
    if (!Project) throw notConfigured();
    if (mongoose.isValidObjectId(id) && typeof Project.findById === "function") {
      try {
        const p = await Project.findById(id).lean();
        if (p) return p;
      } catch {}
    }
    if (Project.collection && typeof Project.collection.findOne === "function") {
      try {
        const p = await Project.collection.findOne({ _id: id });
        if (p) return p;
      } catch {}
    }
    if (typeof Project.findOne === "function") {
      try {
        return await Project.findOne({ _id: id }).lean();
      } catch {}
    }
    return null;
  },
  loadMembership: async (userId, projectId) => {
    const Membership = loadModel("../models/Membership", "Membership");
    if (!Membership) throw notConfigured();
    if (typeof Membership.findOne === "function") {
      try {
        const m = await Membership.findOne({ userId, projectId }).lean();
        if (m) return m;
      } catch {}
    }
    if (Membership.collection && typeof Membership.collection.findOne === "function") {
      try {
        return await Membership.collection.findOne({ userId, projectId });
      } catch {}
    }
    return null;
  },
  loadSnapshot: async (id) => {
    const Snap = loadModel("../models/RepositorySnapshot", "RepositorySnapshot");
    if (!Snap) throw notConfigured();
    if (mongoose.isValidObjectId(id) && typeof Snap.findById === "function") {
      try {
        const s = await Snap.findById(id).lean();
        if (s) return s;
      } catch {}
    }
    if (Snap.collection && typeof Snap.collection.findOne === "function") {
      try {
        const s = await Snap.collection.findOne({ _id: id });
        if (s) return s;
      } catch {}
    }
    if (typeof Snap.findOne === "function") {
      try {
        return await Snap.findOne({ _id: id }).lean();
      } catch {}
    }
    return null;
  }
};

let overrides = {};
const configureAccess = (next) => { overrides = { ...overrides, ...next }; };
const getDeps = () => ({ ...defaultDeps, ...overrides });

function authorize(...roles) {
  const allowed = roles.flat();
  for (const r of allowed) {
    if (!ROLES.includes(r)) throw new Error(`authorize: unknown role "${r}"`);
  }
  const set = new Set(allowed);
  return (req, res, next) => {
    const a = req.auth;
    if (!a || !a.userId) return next(httpError(401, "UNAUTHENTICATED", "Authentication is required"));
    if (!set.has(a.role) || (a.role === "maintainer" && !a.maintainerVerified)) {
      return next(httpError(403, "FORBIDDEN", "You do not have permission to perform this action"));
    }
    return next();
  };
}

async function assertProjectAccess(auth, projectId, { minRole = null } = {}) {
  if (!projectId || (!mongoose.isValidObjectId(projectId) && !String(projectId).startsWith("seed-"))) throw notFound();
  const d = getDeps();
  const project = await d.loadProject(projectId);
  if (!project) throw notFound();
  const isPublic = project.visibility === "public" && (project.approved === true || project.status === "approved");
  const membership = auth ? await d.loadMembership(auth.userId, projectId) : null;
  const active = Boolean(membership && membership.status === "active");

  if (!isPublic && !active) throw notFound();               // concealed
  if (!minRole) return { project, membership };
  if (!auth) throw httpError(401, "UNAUTHENTICATED", "Authentication is required");
  if (minRole === "maintainer" &&
      !(active && membership.role === "maintainer" && auth.role === "maintainer" && auth.maintainerVerified)) {
    throw httpError(403, "FORBIDDEN", "You do not have permission to perform this action");
  }
  return { project, membership };
}

function assertNotPlanOwner(auth, plan) {
  if (String(plan.contributorId) === String(auth.userId)) {
    throw httpError(403, "FORBIDDEN", "You cannot review your own contribution plan");
  }
}

async function assertSnapshotAccess(auth, snapshotId, { projectId = null, minRole = null } = {}) {
  if (!snapshotId || (!mongoose.isValidObjectId(snapshotId) && !String(snapshotId).startsWith("seed-"))) throw notFound();
  const snapshot = await getDeps().loadSnapshot(snapshotId);
  if (!snapshot) throw notFound();
  if (["failed", "revoked"].includes(snapshot.status)) throw notFound();
  if (projectId && String(snapshot.projectId) !== String(projectId)) throw notFound();
  const { project, membership } =
    await assertProjectAccess(auth, String(snapshot.projectId), { minRole });
  const member = Boolean(membership && membership.status === "active");
  if (snapshot.visibility !== "public" && !member) throw notFound(); // private snapshot concealed
  return { snapshot, project, membership };
}

async function buildRetrievalScope(auth, projectId, snapshotId) {
  const { snapshot, membership } =
    await assertSnapshotAccess(auth, snapshotId, { projectId });
  const member = Boolean(membership && membership.status === "active");
  return {
    projectId: String(snapshot.projectId),
    snapshotId: String(snapshot._id),
    visibility: member ? ["public", "private"] : ["public"]
  };
}

module.exports = { ROLES, httpError, configureAccess, authorize,
  assertProjectAccess, assertSnapshotAccess, buildRetrievalScope, assertNotPlanOwner };
