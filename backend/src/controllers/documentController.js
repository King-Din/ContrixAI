"use strict";
const { objectId } = require("../validation/documentSchemas");
const { importSnapshot, retrieveDocuments, getSnapshotStatus } = require("../services/documentKnowledgeService");
function validProjectId(value) { const parsed = objectId.safeParse(value); if (!parsed.success) { const e = new Error("Invalid project identifier"); e.status = 400; e.code = "VALIDATION_ERROR"; throw e; } return parsed.data; }
function sendError(next, error) { return next(error); }
async function importProjectDocs(req, res, next) {
  try {
    const projectId = validProjectId(req.params.projectId || req.params.id);
    const data = await importSnapshot({ projectId, auth: { ...req.auth, projectAccess: Boolean(req.projectAccess) }, body: req.body });
    return res.status(201).json({ success: true, data, meta: { requestId: req.requestId || null } });
  } catch (error) { return sendError(next, error); }
}
async function searchProjectDocs(req, res, next) {
  try {
    const projectId = validProjectId(req.params.projectId || req.params.id);
    const { searchSchema } = require("../validation/documentSchemas");
    const parsed = searchSchema.safeParse(req.body);
    if (!parsed.success) { const e = new Error("Invalid documentation search payload"); e.status = 400; e.code = "VALIDATION_ERROR"; e.details = parsed.error.issues; throw e; }
    const data = await retrieveDocuments({ projectId, auth: { ...req.auth, projectAccess: Boolean(req.projectAccess) }, ...parsed.data });
    return res.status(200).json({ success: true, data, meta: { requestId: req.requestId || null } });
  } catch (error) { return sendError(next, error); }
}
async function listProjectSnapshots(req, res, next) {
  try {
    const projectId = validProjectId(req.params.projectId || req.params.id);
    const data = await getSnapshotStatus({ projectId, auth: { ...req.auth, projectAccess: Boolean(req.projectAccess) } });
    return res.status(200).json({ success: true, data, meta: { requestId: req.requestId || null } });
  } catch (error) { return sendError(next, error); }
}
module.exports = { importProjectDocs, searchProjectDocs, listProjectSnapshots };
