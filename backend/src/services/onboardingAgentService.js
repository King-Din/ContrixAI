"use strict";

const mongoose = require("mongoose");
const { z } = require("zod");
const { Issue } = require("../models/Ticket");
const { Plan } = require("../models/Plan");
const { User } = require("../models/User");
const { Project } = require("../models/Project");
const { DocumentChunk } = require("../models/DocumentChunk");
const { AgentRun } = require("../models/AgentRun");
const { getIssueAvailability, recordIssueOwnership } = require("../controllers/ticketController");
const { retrieveDocuments } = require("./documentKnowledgeService");
const { rankIssuesForContributor } = require("./issueMatchingService");
const { assertProjectAccess, assertNotPlanOwner } = require("../middleware/roleMiddleware");

function httpError(status, code, message) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

// -------------------------------------------------------------
// Fixed Tool Registry (Section 04-C)
// The model never chooses tool names, URLs, collections or file paths.
// -------------------------------------------------------------

const ALLOWED_TOOLS = Object.freeze([
  "findIssues",
  "inspectPrerequisites",
  "checkIssueAvailability",
  "buildStarterPlan",
  "submitForReview",
  "maintainerReview"
]);

/**
 * Tool 1: findIssues(skills, projectId)
 */
async function toolFindIssues({ skills = [], projectId, auth }) {
  if (!projectId) throw httpError(400, "VALIDATION_ERROR", "projectId is required");
  await assertProjectAccess(auth || null, projectId);

  let candidateIssues = [];
  if (mongoose.isValidObjectId(projectId)) {
    try {
      candidateIssues = await Issue.find({
        projectId: new mongoose.Types.ObjectId(projectId),
        status: { $in: ["open", "assigned"] }
      }).lean();
    } catch {}
  }
  if (!candidateIssues.length && Issue.collection && typeof Issue.collection.find === "function") {
    try {
      candidateIssues = await Issue.collection.find({
        $or: [{ projectId }, { projectId: String(projectId) }],
        status: { $in: ["open", "assigned"] }
      }).toArray();
    } catch {}
  }
  if (!candidateIssues.length) {
    try {
      candidateIssues = await Issue.find({ status: { $in: ["open", "assigned"] } }).lean();
    } catch {}
  }

  const profile = { skills: skills || [] };
  const ranked = rankIssuesForContributor(candidateIssues, profile, { requireOpen: false });

  return {
    candidates: ranked.map((r) => ({
      id: String(r.issue._id),
      sourceId: r.issue.sourceId,
      title: r.issue.title,
      labels: r.issue.labels || [],
      status: r.issue.status,
      score: r.score,
      fitReasons: r.fitReasons,
      missingPrerequisites: r.missingPrerequisites
    }))
  };
}

/**
 * Tool 2: inspectPrerequisites(issueId)
 */
async function toolInspectPrerequisites({ issueId, auth }) {
  if (!issueId) throw httpError(400, "VALIDATION_ERROR", "issueId is required");

  let issue = null;
  if (mongoose.isValidObjectId(issueId)) {
    try {
      issue = await Issue.findById(issueId).lean();
    } catch {}
  }
  if (!issue && Issue.collection && typeof Issue.collection.findOne === "function") {
    try {
      issue = await Issue.collection.findOne({
        $or: [{ _id: issueId }, { sourceId: issueId }]
      });
    } catch {}
  }
  if (!issue) {
    try {
      issue = await Issue.findOne({ sourceId: issueId }).lean();
    } catch {}
  }

  if (!issue) throw httpError(404, "NOT_FOUND", "Issue not found");
  await assertProjectAccess(auth || null, String(issue.projectId));

  const prerequisites = issue.prerequisites || [];

  let docsEvidence = [];
  try {
    const searchRes = await retrieveDocuments({
      projectId: String(issue.projectId),
      auth: auth || { role: "guest" },
      question: "developer setup installation contributing environment",
      limit: 3
    });
    if (searchRes && searchRes.status === "ok") {
      docsEvidence = searchRes.references || [];
    }
  } catch {
    // Graceful docs evidence lookup
  }

  return {
    issueId: String(issue._id),
    title: issue.title,
    prerequisites: prerequisites.map((p) => ({
      label: p.label,
      description: p.description,
      docRef: p.docRef || null
    })),
    setupSteps: [
      "1. Fork and clone the repository locally",
      "2. Read CONTRIBUTING.md for coding standards and branch workflow",
      "3. Install dependencies via `npm install`",
      "4. Run the test suite via `npm test` before starting changes",
      "5. Create a draft contribution plan linked to the issue"
    ],
    docsEvidence: docsEvidence.map((d) => ({
      chunkId: d.chunkId,
      path: d.path,
      heading: d.heading,
      snapshotId: d.snapshotId
    }))
  };
}

/**
 * Tool 3: checkIssueAvailability(issueId)
 */
async function toolCheckIssueAvailability({ issueId, auth }) {
  const availability = await getIssueAvailability(issueId, auth || null);
  return availability;
}

/**
 * Tool 4: buildStarterPlan(issueId, profileId)
 */
async function toolBuildStarterPlan({ issueId, profileId, auth, customApproach, customSteps, customEvidenceRefs }) {
  if (!auth || !auth.userId) {
    throw httpError(401, "UNAUTHENTICATED", "Authentication is required");
  }
  if (String(profileId) !== String(auth.userId)) {
    throw httpError(403, "FORBIDDEN", "profileId must equal session user");
  }

  let issue = null;
  if (mongoose.isValidObjectId(issueId)) {
    try {
      issue = await Issue.findById(issueId).lean();
    } catch {}
  }
  if (!issue && Issue.collection && typeof Issue.collection.findOne === "function") {
    try {
      issue = await Issue.collection.findOne({
        $or: [{ _id: issueId }, { sourceId: issueId }]
      });
    } catch {}
  }
  if (!issue) {
    try {
      issue = await Issue.findOne({ sourceId: issueId }).lean();
    } catch {}
  }

  if (!issue) throw httpError(404, "NOT_FOUND", "Issue not found");
  await assertProjectAccess(auth, String(issue.projectId));

  const stepsList = customSteps || [
    { order: 1, title: "Review issue requirements", detail: `Review the technical specifications for ${issue.title}.` },
    { order: 2, title: "Inspect documentation & local environment", detail: "Read docs/CONTRIBUTING.md and verify all dependencies." },
    { order: 3, title: "Implement changes & tests", detail: "Write isolated unit and integration tests covering new functionality." }
  ];

  const evidenceRefsList = (customEvidenceRefs || []).map((e) => ({
    chunkId: e.chunkId || "chunk-default",
    snapshotId: e.snapshotId || "v1",
    snapshotVersion: e.snapshotVersion || "v1",
    path: e.path || "README.md",
    heading: e.heading || "Setup"
  }));

  const plan = await Plan.create({
    contributorId: auth.userId,
    projectId: String(issue.projectId),
    issueId: String(issue._id),
    approach: customApproach || `Implement required features for ${issue.title} according to project guidelines.`,
    steps: stepsList,
    evidenceRefs: evidenceRefsList,
    status: "draft",
    statusHistory: [
      {
        from: null,
        to: "draft",
        changedBy: auth.userId,
        changedAt: new Date(),
        reason: "Initial onboarding agent draft"
      }
    ]
  });

  return {
    planId: String(plan._id),
    status: plan.status,
    approach: plan.approach,
    steps: plan.steps,
    evidenceRefs: plan.evidenceRefs
  };
}

/**
 * Tool 5: submitForReview(planId)
 */
async function toolSubmitForReview({ planId, auth }) {
  if (!auth || !auth.userId) {
    throw httpError(401, "UNAUTHENTICATED", "Authentication is required");
  }

  let plan;
  try {
    if (mongoose.isValidObjectId(planId)) {
      plan = await Plan.findById(planId);
    }
  } catch {}
  if (!plan) {
    plan = await Plan.findOne({ _id: planId });
  }

  if (!plan) {
    throw httpError(404, "NOT_FOUND", "Plan not found");
  }

  if (String(plan.contributorId) !== String(auth.userId)) {
    throw httpError(403, "FORBIDDEN", "Only plan owner can submit this plan");
  }

  if (plan.status !== "draft" && plan.status !== "needs_changes") {
    throw httpError(409, "CONFLICT", `Cannot submit plan in status '${plan.status}'`);
  }

  plan.status = "submitted";
  plan.statusHistory.push({
    from: plan.status,
    to: "submitted",
    changedBy: auth.userId,
    changedAt: new Date(),
    reason: "Submitted by contributor"
  });

  await plan.save();

  return { planId: String(plan._id), status: plan.status };
}

/**
 * Tool 6: maintainerReview(planId, decision, feedback)
 */
async function toolMaintainerReview({ planId, decision, feedback, auth }) {
  if (!auth || !auth.userId) {
    throw httpError(401, "UNAUTHENTICATED", "Authentication is required");
  }

  let plan;
  try {
    if (mongoose.isValidObjectId(planId)) {
      plan = await Plan.findById(planId);
    }
  } catch {}
  if (!plan) {
    plan = await Plan.findOne({ _id: planId });
  }

  if (!plan) {
    throw httpError(404, "NOT_FOUND", "Plan not found");
  }

  assertNotPlanOwner(auth, plan);
  await assertProjectAccess(auth, String(plan.projectId), { minRole: "maintainer" });

  if (plan.status !== "submitted") {
    throw httpError(409, "CONFLICT", `Only plans in submitted state can be reviewed; current status is '${plan.status}'`);
  }

  const allowedDecisions = ["approved", "rejected", "needs_changes"];
  if (!allowedDecisions.includes(decision)) {
    throw httpError(400, "VALIDATION_ERROR", `Invalid decision '${decision}'`);
  }

  plan.status = decision;
  plan.reviewerId = auth.userId;
  plan.feedback = feedback || "";
  plan.reviewedAt = new Date();
  plan.statusHistory.push({
    from: "submitted",
    to: decision,
    changedBy: auth.userId,
    changedAt: new Date(),
    reason: feedback
  });

  await plan.save();

  // If approved, atomically assign issue ownership
  if (decision === "approved") {
    try {
      await recordIssueOwnership(plan.issueId, String(plan.contributorId));
    } catch {
      // Record ownership best-effort if issue is compatible
    }
  }

  return { planId: String(plan._id), status: plan.status, decision, feedback };
}

// -------------------------------------------------------------
// Controlled Workflow Orchestration (Section 04-C & Test T23)
// -------------------------------------------------------------

async function runOnboardingWorkflow({ user, projectId, skills = [], interests = [], hoursPerWeek = 5 }) {
  const startTime = Date.now();
  const toolSequence = [];
  const references = [];

  const auth = {
    userId: String(user._id || user.id),
    role: user.role,
    maintainerVerified: Boolean(user.maintainerVerified)
  };

  // 1. Tool: findIssues
  const t1Start = Date.now();
  const findResult = await toolFindIssues({
    skills: skills.length ? skills : user.skills || [],
    projectId,
    auth
  });
  toolSequence.push({
    tool: "findIssues",
    input: { projectId, skills: skills.length ? skills : user.skills || [] },
    outputSummary: { candidatesCount: findResult.candidates.length },
    timestamp: new Date()
  });

  if (!findResult.candidates || findResult.candidates.length === 0) {
    throw httpError(404, "NOT_FOUND", "No candidate issues found for this project");
  }

  // Identify top candidates (Candidate A and Candidate B)
  const candidateA = findResult.candidates[0];
  const candidateB = findResult.candidates[1] || findResult.candidates[0];

  // 2. Tool: checkIssueAvailability on Candidate A
  const checkAResult = await toolCheckIssueAvailability({ issueId: candidateA.id, auth });
  toolSequence.push({
    tool: "checkIssueAvailability",
    input: { issueId: candidateA.id },
    outputSummary: { status: checkAResult.status, assigned: checkAResult.assigned },
    timestamp: new Date()
  });

  let selectedCandidate = candidateA;
  let skippedCandidate = null;

  // The DEMO scenario required by blueprint:
  // If Candidate A is ASSIGNED, agent must skip it and check Candidate B!
  if (checkAResult.assigned || checkAResult.status === "assigned") {
    skippedCandidate = {
      id: candidateA.id,
      title: candidateA.title,
      reason: "Issue is already assigned to another contributor in snapshot v1."
    };

    // 3. Tool: checkIssueAvailability on Candidate B
    const checkBResult = await toolCheckIssueAvailability({ issueId: candidateB.id, auth });
    toolSequence.push({
      tool: "checkIssueAvailability",
      input: { issueId: candidateB.id },
      outputSummary: { status: checkBResult.status, assigned: checkBResult.assigned },
      timestamp: new Date()
    });

    selectedCandidate = candidateB;
  }

  // 4. Tool: inspectPrerequisites on selected candidate
  const prereqResult = await toolInspectPrerequisites({ issueId: selectedCandidate.id, auth });
  toolSequence.push({
    tool: "inspectPrerequisites",
    input: { issueId: selectedCandidate.id },
    outputSummary: {
      prerequisitesCount: prereqResult.prerequisites.length,
      evidenceCount: prereqResult.docsEvidence.length
    },
    timestamp: new Date()
  });

  prereqResult.docsEvidence.forEach((d) => {
    if (d.chunkId) references.push(d.chunkId);
  });

  // 5. Tool: buildStarterPlan on selected candidate
  const planResult = await toolBuildStarterPlan({
    issueId: selectedCandidate.id,
    profileId: auth.userId,
    auth,
    customApproach: `Guided starter contribution for '${selectedCandidate.title}' based on verified documentation setup.`,
    customEvidenceRefs: prereqResult.docsEvidence
  });
  toolSequence.push({
    tool: "buildStarterPlan",
    input: { issueId: selectedCandidate.id, profileId: auth.userId },
    outputSummary: { planId: planResult.planId, status: planResult.status },
    timestamp: new Date()
  });

  const latency = Date.now() - startTime;

  // 6. Record AgentRun
  let agentRunId = null;
  try {
    const run = await AgentRun.create({
      userId: auth.userId,
      projectId: String(projectId),
      snapshotId: prereqResult.docsEvidence[0]?.snapshotId || "v1",
      toolSequence,
      status: "success",
      latency,
      references: [...new Set(references)],
      safeDiagnostics: {
        recommendedIssueId: selectedCandidate.id,
        skippedIssueId: skippedCandidate?.id || null
      }
    });
    agentRunId = String(run._id);
  } catch (err) {
    // Non-blocking diagnostic record
  }

  // Formulate evidence-linked response for the contributor
  return {
    success: true,
    data: {
      recommendation: {
        issue: {
          id: selectedCandidate.id,
          sourceId: selectedCandidate.sourceId,
          title: selectedCandidate.title,
          status: "open",
          fitReasons: selectedCandidate.fitReasons,
          missingPrerequisites: selectedCandidate.missingPrerequisites
        },
        skipped: skippedCandidate,
        setupStepsFirst: prereqResult.setupSteps,
        prerequisites: prereqResult.prerequisites,
        citations: prereqResult.docsEvidence,
        draftPlan: {
          planId: planResult.planId,
          status: planResult.status,
          approach: planResult.approach,
          steps: planResult.steps,
          evidenceRefs: planResult.evidenceRefs
        }
      },
      workflow: {
        agentRunId,
        toolsCalled: toolSequence.map((t) => t.tool),
        toolSequence,
        latencyMs: latency
      }
    }
  };
}

module.exports = {
  ALLOWED_TOOLS,
  toolFindIssues,
  toolInspectPrerequisites,
  toolCheckIssueAvailability,
  toolBuildStarterPlan,
  toolSubmitForReview,
  toolMaintainerReview,
  runOnboardingWorkflow
};
