"use strict";
/*
 * AI TOOL AUTHORIZATION CHECKLIST (M4). Identity always comes from the server
 * session (req.auth), never from model-supplied arguments. The model never
 * chooses project, snapshot, collection or tool name. Checks run inside each
 * tool, not only on Express routes.
 *
 * findIssues(skills, projectId)
 *   role: authenticated contributor | scope: assertProjectAccess(auth, projectId);
 *   project approved; open issues only | side effects: none
 * inspectPrerequisites(issueId)
 *   role: authenticated | scope: issue's project readable (assertProjectAccess);
 *   docs only from an authorized snapshot (assertSnapshotAccess) | side effects: none
 * checkIssueAvailability(issueId)
 *   role: authenticated | scope: issue's project readable | side effects: none
 * buildStarterPlan(issueId, profileId)
 *   role: contributor | scope: profileId === auth.userId; issue and snapshot
 *   belong to the same project | side effects: draft only
 * submitForReview(planId)
 *   role: contributor | scope: plan.contributorId === auth.userId; draft -> submitted only
 *   | side effects: status change only
 * maintainerReview(planId, decision, feedback)
 *   role: verified maintainer | scope: active maintainer membership on plan's project
 *   (assertProjectAccess minRole "maintainer"); assertNotPlanOwner; valid transition
 *   | side effects: decision, feedback, ownership record
 *
 * Retrieval rule for M8 / D1: call assertSnapshotAccess BEFORE retrieval and AGAIN on
 * the final citation list before returning it.
 */
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