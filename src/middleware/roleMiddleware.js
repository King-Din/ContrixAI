"use strict";
const mongoose = require("mongoose");

const ROLES = Object.freeze(["contributor", "maintainer", "moderator"]);
const httpError = (status, code, message) =>
  Object.assign(new Error(message), { status, code });
const notFound = () => httpError(404, "NOT_FOUND", "The requested resource was not found");

let deps = {}; // { loadProject(id), loadMembership(userId, projectId), loadSnapshot(id) }
const configureAccess = (next) => { deps = { ...deps, ...next }; };

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
  if (!mongoose.isValidObjectId(projectId)) throw notFound();
  if (!deps.loadProject || !deps.loadMembership) {
    throw httpError(500, "SERVER_ERROR", "Project access is not configured"); // fail closed
  }
  const project = await deps.loadProject(projectId);
  if (!project) throw notFound();
  const isPublic = project.visibility === "public" && project.approved === true; // field names: pending D3
  const membership = auth ? await deps.loadMembership(auth.userId, projectId) : null;
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

async function assertSnapshotAccess() { throw httpError(500, "SERVER_ERROR", "Snapshot access is not configured"); } // stub until D3

module.exports = { ROLES, httpError, configureAccess, authorize,
  assertProjectAccess, assertSnapshotAccess, assertNotPlanOwner };