"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const {
  Issue,
  Ticket,
  IssueInterest,
  ISSUE_STATUS,
  ISSUE_STATUS_TRANSITIONS
} = require("../src/models/Ticket");
const { User } = require("../src/models/User");
const {
  protect,
  optionalProtect
} = require("../src/middleware/authMiddleware");
const {
  authorize,
  configureAccess
} = require("../src/middleware/roleMiddleware");
const {
  listProjects,
  listProjectIssues,
  expressInterest,
  patchIssue,
  getIssueAvailability,
  recordIssueOwnership
} = require("../src/controllers/ticketController");
const { errorMiddleware } = require("../src/middleware/errorMiddleware");

// Fixed test identifiers (valid 24-character hex ObjectIds)
const U_CONTRIBUTOR = "64b000000000000000000001";
const U_CONTRIBUTOR_2 = "64b000000000000000000002";
const U_MAINTAINER = "64b000000000000000000003";
const U_MAINTAINER_UNVERIFIED = "64b000000000000000000004";
const U_MODERATOR = "64b000000000000000000005";
const U_INACTIVE = "64b000000000000000000006";

const P_PUBLIC = "64b0000000000000000000a1";
const P_PRIVATE = "64b0000000000000000000b2";
const P_OTHER = "64b0000000000000000000c3";

const I_OPEN = "64b000000000000000000101";
const I_ASSIGNED = "64b000000000000000000102";
const I_CLOSED = "64b000000000000000000103";
const I_PRIVATE = "64b000000000000000000104";

// Helper: Mock HTTP Response
function mockResponse() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    }
  };
}

// Helper: Execute Express middleware chain with standard errorMiddleware integration
async function executeChain(middlewares, req) {
  const res = mockResponse();
  let idx = 0;
  async function next(err) {
    if (err) {
      errorMiddleware(err, req, res, () => {});
      return;
    }
    if (idx < middlewares.length) {
      const mw = middlewares[idx++];
      try {
        await mw(req, res, next);
      } catch (e) {
        await next(e);
      }
    }
  }
  await next();
  return res;
}

// Setup mock projects & memberships in roleMiddleware deps
const mockProjects = {
  [P_PUBLIC]: { _id: P_PUBLIC, visibility: "public", approved: true },
  [P_PRIVATE]: { _id: P_PRIVATE, visibility: "private", approved: true },
  [P_OTHER]: { _id: P_OTHER, visibility: "public", approved: true }
};

function setupProjectAccess(memberships = {}) {
  configureAccess({
    loadProject: async (id) => mockProjects[id] || null,
    loadMembership: async (userId, projectId) => memberships[`${userId}:${projectId}`] || null
  });
}

function resetProjectAccess() {
  configureAccess({
    loadProject: undefined,
    loadMembership: undefined
  });
}

// Global User stub dictionary for offline unit testing
const mockUsers = {
  [U_CONTRIBUTOR]: { _id: U_CONTRIBUTOR, name: "Ada", role: "contributor", emailVerified: true, maintainerVerified: false, isActive: true },
  [U_CONTRIBUTOR_2]: { _id: U_CONTRIBUTOR_2, name: "Bob", role: "contributor", emailVerified: true, maintainerVerified: false, isActive: true },
  [U_MAINTAINER]: { _id: U_MAINTAINER, name: "Grace", role: "maintainer", emailVerified: true, maintainerVerified: true, isActive: true },
  [U_MAINTAINER_UNVERIFIED]: { _id: U_MAINTAINER_UNVERIFIED, name: "Dan", role: "maintainer", emailVerified: true, maintainerVerified: false, isActive: true },
  [U_MODERATOR]: { _id: U_MODERATOR, name: "Margaret", role: "moderator", emailVerified: true, maintainerVerified: false, isActive: true },
  [U_INACTIVE]: { _id: U_INACTIVE, name: "Inactive", role: "contributor", emailVerified: true, maintainerVerified: false, isActive: false }
};

const originalUserFindById = User.findById;
function installUserStub() {
  User.findById = (id) => ({
    select: () => ({
      lean: async () => mockUsers[String(id)] || null
    })
  });
}

function restoreUserStub() {
  User.findById = originalUserFindById;
}

// ==========================================
// 1. SCHEMA TESTS
// ==========================================

test("M7 Schema: Ticket is an identical alias of Issue", () => {
  assert.equal(Ticket, Issue);
  assert.equal(Issue.collection.name, "issues");
  assert.equal(IssueInterest.collection.name, "issueinterests");
});

test("M7 Schema: Enums and Transitions match Edition 3.0 specification", () => {
  assert.deepEqual(ISSUE_STATUS, {
    OPEN: "open",
    ASSIGNED: "assigned",
    CLOSED: "closed"
  });
  assert.deepEqual(ISSUE_STATUS_TRANSITIONS, {
    open: ["assigned"],
    assigned: ["open", "closed"],
    closed: []
  });
});

test("M7 Schema: Issue model indexes are registered", () => {
  const indexes = Issue.schema.indexes();
  const indexKeys = indexes.map(([fields]) => Object.keys(fields).join("_"));
  assert.ok(indexKeys.includes("projectId_status"));
  assert.ok(indexKeys.includes("projectId_sourceId"));
  assert.ok(indexKeys.includes("labels"));

  const uniqueCompound = indexes.find(([fields]) => fields.projectId === 1 && fields.sourceId === 1);
  assert.ok(uniqueCompound);
  assert.equal(uniqueCompound[1].unique, true);
});

test("M7 Schema: IssueInterest has partial unique index on active interest", () => {
  const indexes = IssueInterest.schema.indexes();
  const partialUnique = indexes.find(
    ([fields, opts]) => fields.issueId === 1 && fields.contributorId === 1 && opts.unique === true
  );
  assert.ok(partialUnique);
  assert.deepEqual(partialUnique[1].partialFilterExpression, { status: "active" });
});

test("M7 Schema: bounds reject excess labels, requirements, and prerequisites", () => {
  const labelsValidator = Issue.schema.path("labels").validators.find((v) => v.message.includes("Maximum 20"));
  assert.ok(labelsValidator);
  assert.equal(labelsValidator.validator(new Array(20).fill("tag")), true);
  assert.equal(labelsValidator.validator(new Array(21).fill("tag")), false);

  const reqsValidator = Issue.schema.path("requirements").validators.find((v) => v.message.includes("Maximum 20"));
  assert.ok(reqsValidator);
  assert.equal(reqsValidator.validator(new Array(20).fill("req")), true);
  assert.equal(reqsValidator.validator(new Array(21).fill("req")), false);

  const prereqsValidator = Issue.schema.path("prerequisites").validators.find((v) => v.message.includes("Maximum 20"));
  assert.ok(prereqsValidator);
  assert.equal(prereqsValidator.validator(new Array(20).fill({ label: "l", description: "d" })), true);
  assert.equal(prereqsValidator.validator(new Array(21).fill({ label: "l", description: "d" })), false);
});

// ==========================================
// 2. GET /api/projects
// ==========================================

test("M7: GET /api/projects fails closed with 500 when Project model is not registered", async () => {
  const origProject = mongoose.models.Project;
  delete mongoose.models.Project;
  try {
    const req = { query: {}, requestId: "req-p1" };
    const res = await executeChain([optionalProtect, listProjects], req);
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.code, "SERVER_ERROR");
  } finally {
    if (origProject) mongoose.models.Project = origProject;
  }
});

test("M7: GET /api/projects lists approved public projects with computed openIssueCount", async () => {
  const mockProjectModel = {
    countDocuments: async () => 1,
    find: () => ({
      sort: () => ({
        skip: () => ({
          limit: () => ({
            lean: async () => [
              {
                _id: new mongoose.Types.ObjectId(P_PUBLIC),
                name: "Public Project",
                slug: "public-project",
                description: "Open source",
                visibility: "public",
                approved: true
              }
            ]
          })
        })
      })
    })
  };

  const origProject = mongoose.models.Project;
  const origAggregate = Issue.aggregate;
  mongoose.models.Project = mockProjectModel;

  Issue.aggregate = async () => [
    { _id: new mongoose.Types.ObjectId(P_PUBLIC), count: 3 }
  ];

  try {
    const req = { query: { page: "1", limit: "20" }, requestId: "req-p2" };
    const res = await executeChain([optionalProtect, listProjects], req);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.projects.length, 1);
    assert.equal(res.body.data.projects[0].openIssueCount, 3);
    assert.equal(res.body.data.projects[0]._id, P_PUBLIC);
    assert.equal(res.body.meta.pagination.page, 1);
  } finally {
    Issue.aggregate = origAggregate;
    if (origProject) mongoose.models.Project = origProject;
    else delete mongoose.models.Project;
  }
});

test("M7: GET /api/projects caps limit=10000 to 50", async () => {
  let capturedLimit = null;
  const mockProjectModel = {
    countDocuments: async () => 1,
    find: () => ({
      sort: () => ({
        skip: () => ({
          limit: (n) => {
            capturedLimit = n;
            return { lean: async () => [] };
          }
        })
      })
    })
  };

  const origProject = mongoose.models.Project;
  const origAggregate = Issue.aggregate;
  mongoose.models.Project = mockProjectModel;
  Issue.aggregate = async () => [];

  try {
    const req = { query: { limit: "10000" }, requestId: "req-cap" };
    const res = await executeChain([optionalProtect, listProjects], req);
    assert.equal(res.statusCode, 200);
    assert.equal(capturedLimit, 50);
    assert.equal(res.body.meta.pagination.limit, 50);
  } finally {
    Issue.aggregate = origAggregate;
    if (origProject) mongoose.models.Project = origProject;
    else delete mongoose.models.Project;
  }
});

test("M7: GET /api/projects rejects non-numeric page with 400 VALIDATION_ERROR", async () => {
  const req = { query: { page: "abc" }, requestId: "req-nan" };
  const res = await executeChain([optionalProtect, listProjects], req);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, "VALIDATION_ERROR");
});

// ==========================================
// 3. GET /api/projects/:projectId/issues
// ==========================================

test("M7: GET /api/projects/:projectId/issues rejects invalid ObjectId with 400", async () => {
  const req = { params: { projectId: "not-an-objectid" }, query: {}, requestId: "req-inv" };
  const res = await executeChain([optionalProtect, listProjectIssues], req);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, "VALIDATION_ERROR");
});

test("M7: GET /api/projects/:projectId/issues conceals private project from anonymous caller (404)", async () => {
  setupProjectAccess();
  try {
    const req = {
      params: { projectId: P_PRIVATE },
      query: {},
      auth: null,
      requestId: "req-priv"
    };
    const res = await executeChain([optionalProtect, listProjectIssues], req);
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.code, "NOT_FOUND");
  } finally {
    resetProjectAccess();
  }
});

test("M7: GET /api/projects/:projectId/issues returns issues for public project without exposing assigneeId", async () => {
  setupProjectAccess();
  const origCount = Issue.countDocuments;
  const origFind = Issue.find;

  Issue.countDocuments = async () => 1;
  Issue.find = () => ({
    sort: () => ({
      skip: () => ({
        limit: () => ({
          lean: async () => [
            {
              _id: new mongoose.Types.ObjectId(I_ASSIGNED),
              projectId: new mongoose.Types.ObjectId(P_PUBLIC),
              sourceId: "ISSUE-101",
              title: "Test Assigned Issue",
              body: "Details",
              labels: ["frontend"],
              requirements: ["React"],
              prerequisites: [{ label: "setup", description: "run npm install" }],
              status: "assigned",
              assigneeId: new mongoose.Types.ObjectId(U_CONTRIBUTOR),
              sourceVersion: "v1",
              createdAt: new Date(),
              updatedAt: new Date()
            }
          ]
        })
      })
    })
  });

  try {
    const req = {
      params: { projectId: P_PUBLIC },
      query: {},
      auth: null,
      requestId: "req-pub-issues"
    };
    const res = await executeChain([optionalProtect, listProjectIssues], req);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.issues.length, 1);

    const issue = res.body.data.issues[0];
    assert.equal(issue.status, "assigned");
    assert.equal(issue.assigned, true);
    // CRITICAL: assigneeId must be strictly absent from public responses
    assert.equal(issue.assigneeId, undefined);
  } finally {
    Issue.countDocuments = origCount;
    Issue.find = origFind;
    resetProjectAccess();
  }
});

test("M7: GET /api/projects/:projectId/issues rejects invalid status filter with 400", async () => {
  setupProjectAccess();
  try {
    const req = {
      params: { projectId: P_PUBLIC },
      query: { status: "unknown_status" },
      auth: null,
      requestId: "req-bad-status"
    };
    const res = await executeChain([optionalProtect, listProjectIssues], req);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, "VALIDATION_ERROR");
  } finally {
    resetProjectAccess();
  }
});

// ==========================================
// 4. POST /api/issues/:id/interest
// ==========================================

test("M7: POST /api/issues/:id/interest rejects unauthenticated request with 401", async () => {
  const req = { session: {}, params: { id: I_OPEN }, requestId: "req-unauth" };
  const res = await executeChain([protect, authorize("contributor"), expressInterest], req);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, "UNAUTHENTICATED");
});

test("M7: POST /api/issues/:id/interest rejects maintainer/moderator with 403 FORBIDDEN", async () => {
  installUserStub();
  try {
    for (const role of ["maintainer", "moderator"]) {
      const userId = role === "maintainer" ? U_MAINTAINER : U_MODERATOR;
      const req = {
        session: { userId },
        params: { id: I_OPEN },
        requestId: `req-role-${role}`
      };
      const res = await executeChain([protect, authorize("contributor"), expressInterest], req);
      assert.equal(res.statusCode, 403);
      assert.equal(res.body.code, "FORBIDDEN");
    }
  } finally {
    restoreUserStub();
  }
});

test("M7: POST /api/issues/:id/interest returns 404 on unknown issue", async () => {
  setupProjectAccess();
  installUserStub();
  const origFindById = Issue.findById;
  Issue.findById = async () => null;

  try {
    const req = {
      session: { userId: U_CONTRIBUTOR },
      params: { id: I_OPEN },
      requestId: "req-404"
    };
    const res = await executeChain([protect, authorize("contributor"), expressInterest], req);
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.code, "NOT_FOUND");
  } finally {
    Issue.findById = origFindById;
    restoreUserStub();
    resetProjectAccess();
  }
});

test("M7: POST /api/issues/:id/interest rejects interest on assigned or closed issue with 409 CONFLICT", async () => {
  setupProjectAccess();
  installUserStub();
  const origFindById = Issue.findById;

  try {
    for (const status of ["assigned", "closed"]) {
      Issue.findById = async () => ({
        _id: new mongoose.Types.ObjectId(I_ASSIGNED),
        projectId: new mongoose.Types.ObjectId(P_PUBLIC),
        status
      });

      const req = {
        session: { userId: U_CONTRIBUTOR },
        params: { id: I_ASSIGNED },
        requestId: `req-status-${status}`
      };
      const res = await executeChain([protect, authorize("contributor"), expressInterest], req);
      assert.equal(res.statusCode, 409);
      assert.equal(res.body.code, "CONFLICT");
    }
  } finally {
    Issue.findById = origFindById;
    restoreUserStub();
    resetProjectAccess();
  }
});

test("M7: POST /api/issues/:id/interest creates interest and ignores body-supplied identity", async () => {
  setupProjectAccess();
  installUserStub();
  const origFindById = Issue.findById;
  const origFindOne = IssueInterest.findOne;
  const origCreate = IssueInterest.create;

  Issue.findById = async () => ({
    _id: new mongoose.Types.ObjectId(I_OPEN),
    projectId: new mongoose.Types.ObjectId(P_PUBLIC),
    status: "open"
  });
  IssueInterest.findOne = async () => null;

  let capturedPayload = null;
  IssueInterest.create = async (doc) => {
    capturedPayload = doc;
    return {
      _id: new mongoose.Types.ObjectId(),
      ...doc,
      createdAt: new Date()
    };
  };

  try {
    const req = {
      session: { userId: U_CONTRIBUTOR },
      params: { id: I_OPEN },
      body: {
        contributorId: "attacker_spoofed_id",
        userId: "attacker_user_id",
        projectId: "attacker_project_id",
        role: "admin",
        createdBy: "attacker"
      },
      requestId: "req-ok-interest"
    };
    const res = await executeChain([protect, authorize("contributor"), expressInterest], req);

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.success, true);
    // Identity strictly derived from session
    assert.equal(String(capturedPayload.contributorId), U_CONTRIBUTOR);
    assert.equal(String(capturedPayload.projectId), P_PUBLIC);
  } finally {
    Issue.findById = origFindById;
    IssueInterest.findOne = origFindOne;
    IssueInterest.create = origCreate;
    restoreUserStub();
    resetProjectAccess();
  }
});

test("M7: POST /api/issues/:id/interest handles duplicate interest via pre-check (409 CONFLICT)", async () => {
  setupProjectAccess();
  installUserStub();
  const origFindById = Issue.findById;
  const origFindOne = IssueInterest.findOne;

  Issue.findById = async () => ({
    _id: new mongoose.Types.ObjectId(I_OPEN),
    projectId: new mongoose.Types.ObjectId(P_PUBLIC),
    status: "open"
  });
  IssueInterest.findOne = async () => ({ _id: "existing-interest", status: "active" });

  try {
    const req = {
      session: { userId: U_CONTRIBUTOR },
      params: { id: I_OPEN },
      requestId: "req-dup-precheck"
    };
    const res = await executeChain([protect, authorize("contributor"), expressInterest], req);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, "CONFLICT");
  } finally {
    Issue.findById = origFindById;
    IssueInterest.findOne = origFindOne;
    restoreUserStub();
    resetProjectAccess();
  }
});

test("M7: POST /api/issues/:id/interest handles duplicate interest via Mongo 11000 error (409 CONFLICT)", async () => {
  setupProjectAccess();
  installUserStub();
  const origFindById = Issue.findById;
  const origFindOne = IssueInterest.findOne;
  const origCreate = IssueInterest.create;

  Issue.findById = async () => ({
    _id: new mongoose.Types.ObjectId(I_OPEN),
    projectId: new mongoose.Types.ObjectId(P_PUBLIC),
    status: "open"
  });
  IssueInterest.findOne = async () => null;
  IssueInterest.create = async () => {
    const mongoErr = new Error("E11000 duplicate key error");
    mongoErr.code = 11000;
    throw mongoErr;
  };

  try {
    const req = {
      session: { userId: U_CONTRIBUTOR },
      params: { id: I_OPEN },
      requestId: "req-dup-11000"
    };
    const res = await executeChain([protect, authorize("contributor"), expressInterest], req);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, "CONFLICT");
  } finally {
    Issue.findById = origFindById;
    IssueInterest.findOne = origFindOne;
    IssueInterest.create = origCreate;
    restoreUserStub();
    resetProjectAccess();
  }
});

// ==========================================
// 5. PATCH /api/issues/:id
// ==========================================

test("M7: PATCH /api/issues/:id rejects unauthenticated request with 401", async () => {
  const req = { session: {}, params: { id: I_OPEN }, body: { status: "assigned" } };
  const res = await executeChain([protect, authorize("maintainer"), patchIssue], req);
  assert.equal(res.statusCode, 401);
});

test("M7: PATCH /api/issues/:id rejects contributor with 403", async () => {
  installUserStub();
  try {
    const req = {
      session: { userId: U_CONTRIBUTOR },
      params: { id: I_OPEN },
      body: { status: "assigned" }
    };
    const res = await executeChain([protect, authorize("maintainer"), patchIssue], req);
    assert.equal(res.statusCode, 403);
  } finally {
    restoreUserStub();
  }
});

test("M7: PATCH /api/issues/:id rejects unverified maintainer with 403", async () => {
  installUserStub();
  try {
    const req = {
      session: { userId: U_MAINTAINER_UNVERIFIED },
      params: { id: I_OPEN },
      body: { status: "assigned" }
    };
    const res = await executeChain([protect, authorize("maintainer"), patchIssue], req);
    assert.equal(res.statusCode, 403);
  } finally {
    restoreUserStub();
  }
});

test("M7: PATCH /api/issues/:id rejects empty body with 400 VALIDATION_ERROR", async () => {
  installUserStub();
  try {
    const req = {
      session: { userId: U_MAINTAINER },
      params: { id: I_OPEN },
      body: {}
    };
    const res = await executeChain([protect, authorize("maintainer"), patchIssue], req);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, "VALIDATION_ERROR");
  } finally {
    restoreUserStub();
  }
});

test("M7: PATCH /api/issues/:id: maintainer of project A cannot patch issue of project B (403/404)", async () => {
  installUserStub();
  setupProjectAccess({
    [`${U_MAINTAINER}:${P_PUBLIC}`]: { status: "active", role: "maintainer" }
  });
  const origFindById = Issue.findById;
  Issue.findById = async () => ({
    _id: new mongoose.Types.ObjectId(I_PRIVATE),
    projectId: new mongoose.Types.ObjectId(P_PRIVATE),
    status: "open"
  });

  try {
    const req = {
      session: { userId: U_MAINTAINER },
      params: { id: I_PRIVATE },
      body: { status: "assigned", assigneeId: U_CONTRIBUTOR }
    };
    const res = await executeChain([protect, authorize("maintainer"), patchIssue], req);
    assert.ok(res.statusCode === 403 || res.statusCode === 404);
  } finally {
    Issue.findById = origFindById;
    restoreUserStub();
    resetProjectAccess();
  }
});

test("M7: PATCH /api/issues/:id rejects invalid transition (open -> closed, closed -> open) with 409 CONFLICT", async () => {
  installUserStub();
  setupProjectAccess({
    [`${U_MAINTAINER}:${P_PUBLIC}`]: { status: "active", role: "maintainer" }
  });
  const origFindById = Issue.findById;

  try {
    // 1. open -> closed (prohibited in D-C)
    Issue.findById = async () => ({
      _id: new mongoose.Types.ObjectId(I_OPEN),
      projectId: new mongoose.Types.ObjectId(P_PUBLIC),
      status: "open"
    });
    const req1 = {
      session: { userId: U_MAINTAINER },
      params: { id: I_OPEN },
      body: { status: "closed" }
    };
    const res1 = await executeChain([protect, authorize("maintainer"), patchIssue], req1);
    assert.equal(res1.statusCode, 409);
    assert.equal(res1.body.code, "CONFLICT");

    // 2. closed -> open (closed is terminal)
    Issue.findById = async () => ({
      _id: new mongoose.Types.ObjectId(I_CLOSED),
      projectId: new mongoose.Types.ObjectId(P_PUBLIC),
      status: "closed"
    });
    const req2 = {
      session: { userId: U_MAINTAINER },
      params: { id: I_CLOSED },
      body: { status: "open" }
    };
    const res2 = await executeChain([protect, authorize("maintainer"), patchIssue], req2);
    assert.equal(res2.statusCode, 409);
    assert.equal(res2.body.code, "CONFLICT");
  } finally {
    Issue.findById = origFindById;
    restoreUserStub();
    resetProjectAccess();
  }
});

test("M7: PATCH /api/issues/:id rejects assigned without assigneeId with 400", async () => {
  installUserStub();
  setupProjectAccess({
    [`${U_MAINTAINER}:${P_PUBLIC}`]: { status: "active", role: "maintainer" }
  });
  const origFindById = Issue.findById;
  Issue.findById = async () => ({
    _id: new mongoose.Types.ObjectId(I_OPEN),
    projectId: new mongoose.Types.ObjectId(P_PUBLIC),
    status: "open",
    assigneeId: null
  });

  try {
    const req = {
      session: { userId: U_MAINTAINER },
      params: { id: I_OPEN },
      body: { status: "assigned" }
    };
    const res = await executeChain([protect, authorize("maintainer"), patchIssue], req);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, "VALIDATION_ERROR");
  } finally {
    Issue.findById = origFindById;
    restoreUserStub();
    resetProjectAccess();
  }
});

test("M7: PATCH /api/issues/:id returns 409 CONFLICT on stale transition (findOneAndUpdate returns null)", async () => {
  installUserStub();
  setupProjectAccess({
    [`${U_MAINTAINER}:${P_PUBLIC}`]: { status: "active", role: "maintainer" }
  });
  const origFindById = Issue.findById;
  const origFindOneAndUpdate = Issue.findOneAndUpdate;

  Issue.findById = async () => ({
    _id: new mongoose.Types.ObjectId(I_OPEN),
    projectId: new mongoose.Types.ObjectId(P_PUBLIC),
    status: "open"
  });
  Issue.findOneAndUpdate = async () => null;

  try {
    const req = {
      session: { userId: U_MAINTAINER },
      params: { id: I_OPEN },
      body: { status: "assigned", assigneeId: U_CONTRIBUTOR }
    };
    const res = await executeChain([protect, authorize("maintainer"), patchIssue], req);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, "CONFLICT");
  } finally {
    Issue.findById = origFindById;
    Issue.findOneAndUpdate = origFindOneAndUpdate;
    restoreUserStub();
    resetProjectAccess();
  }
});

test("M7: PATCH /api/issues/:id executes valid transition and serializes assigneeId for maintainer", async () => {
  installUserStub();
  setupProjectAccess({
    [`${U_MAINTAINER}:${P_PUBLIC}`]: { status: "active", role: "maintainer" }
  });
  const origFindById = Issue.findById;
  const origFindOneAndUpdate = Issue.findOneAndUpdate;

  Issue.findById = async () => ({
    _id: new mongoose.Types.ObjectId(I_OPEN),
    projectId: new mongoose.Types.ObjectId(P_PUBLIC),
    status: "open"
  });

  Issue.findOneAndUpdate = async (_filter, update) => ({
    _id: new mongoose.Types.ObjectId(I_OPEN),
    projectId: new mongoose.Types.ObjectId(P_PUBLIC),
    sourceId: "ISSUE-101",
    title: "Issue 101",
    status: update.$set.status,
    assigneeId: update.$set.assigneeId,
    createdAt: new Date(),
    updatedAt: new Date()
  });

  try {
    const req = {
      session: { userId: U_MAINTAINER },
      params: { id: I_OPEN },
      body: { status: "assigned", assigneeId: U_CONTRIBUTOR }
    };
    const res = await executeChain([protect, authorize("maintainer"), patchIssue], req);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.issue.status, "assigned");
    assert.equal(res.body.data.issue.assigned, true);
    assert.equal(res.body.data.issue.assigneeId, U_CONTRIBUTOR);
  } finally {
    Issue.findById = origFindById;
    Issue.findOneAndUpdate = origFindOneAndUpdate;
    restoreUserStub();
    resetProjectAccess();
  }
});

// ==========================================
// 6. SERVICE FUNCTION: getIssueAvailability (D1)
// ==========================================

test("M7 Availability: assigned issue is reported assigned: true, status: 'assigned'", async () => {
  setupProjectAccess();
  const origFindById = Issue.findById;

  Issue.findById = () => ({
    select: () => ({
      lean: async () => ({
        _id: new mongoose.Types.ObjectId(I_ASSIGNED),
        projectId: new mongoose.Types.ObjectId(P_PUBLIC),
        status: "assigned",
        sourceVersion: "v1",
        snapshotId: "snap-1"
      })
    })
  });

  try {
    const result = await getIssueAvailability(I_ASSIGNED, { userId: U_CONTRIBUTOR, role: "contributor" });
    assert.equal(result.issueId, I_ASSIGNED);
    assert.equal(result.status, "assigned");
    assert.equal(result.assigned, true); // Must NEVER report as available
    assert.equal(result.sourceVersion, "v1");
    assert.deepEqual(result.snapshotFreshness, {
      known: false,
      snapshotId: "snap-1",
      importedAt: null,
      stale: null
    });
  } finally {
    Issue.findById = origFindById;
    resetProjectAccess();
  }
});

test("M7 Availability: open issue is reported assigned: false", async () => {
  setupProjectAccess();
  const origFindById = Issue.findById;

  Issue.findById = () => ({
    select: () => ({
      lean: async () => ({
        _id: new mongoose.Types.ObjectId(I_OPEN),
        projectId: new mongoose.Types.ObjectId(P_PUBLIC),
        status: "open"
      })
    })
  });

  try {
    const result = await getIssueAvailability(I_OPEN, null);
    assert.equal(result.status, "open");
    assert.equal(result.assigned, false);
  } finally {
    Issue.findById = origFindById;
    resetProjectAccess();
  }
});

test("M7 Availability: unknown issue throws 404 NOT_FOUND", async () => {
  setupProjectAccess();
  const origFindById = Issue.findById;

  Issue.findById = () => ({
    select: () => ({
      lean: async () => null
    })
  });

  try {
    await assert.rejects(
      async () => getIssueAvailability(I_OPEN, null),
      (err) => err.status === 404 && err.code === "NOT_FOUND"
    );
  } finally {
    Issue.findById = origFindById;
    resetProjectAccess();
  }
});

test("M7 Availability: malformed issue ID throws 400 VALIDATION_ERROR", async () => {
  await assert.rejects(
    async () => getIssueAvailability("not-an-objectid", null),
    (err) => err.status === 400 && err.code === "VALIDATION_ERROR"
  );
});

// ==========================================
// 7. SERVICE FUNCTION: recordIssueOwnership (M6)
// ==========================================

test("M7 Ownership: atomic transition open -> assigned succeeds", async () => {
  installUserStub();
  const origFindOneAndUpdate = Issue.findOneAndUpdate;

  Issue.findOneAndUpdate = async (filter, update) => {
    assert.equal(filter.status, "open");
    return {
      _id: new mongoose.Types.ObjectId(I_OPEN),
      projectId: new mongoose.Types.ObjectId(P_PUBLIC),
      sourceId: "ISSUE-101",
      title: "Issue 101",
      status: "assigned",
      assigneeId: update.$set.assigneeId,
      createdAt: new Date(),
      updatedAt: new Date()
    };
  };

  try {
    const updated = await recordIssueOwnership(I_OPEN, U_CONTRIBUTOR);
    assert.equal(updated.status, "assigned");
    assert.equal(updated.assigned, true);
    assert.equal(updated.assigneeId, U_CONTRIBUTOR);
  } finally {
    restoreUserStub();
    Issue.findOneAndUpdate = origFindOneAndUpdate;
  }
});

test("M7 Ownership: non-open issue throws 409 CONFLICT", async () => {
  installUserStub();
  const origFindOneAndUpdate = Issue.findOneAndUpdate;

  Issue.findOneAndUpdate = async () => null;

  try {
    await assert.rejects(
      async () => recordIssueOwnership(I_OPEN, U_CONTRIBUTOR),
      (err) => err.status === 409 && err.code === "CONFLICT"
    );
  } finally {
    restoreUserStub();
    Issue.findOneAndUpdate = origFindOneAndUpdate;
  }
});

test("M7 Ownership: inactive user throws 400 VALIDATION_ERROR", async () => {
  installUserStub();
  try {
    await assert.rejects(
      async () => recordIssueOwnership(I_OPEN, U_INACTIVE),
      (err) => err.status === 400 && err.code === "VALIDATION_ERROR"
    );
  } finally {
    restoreUserStub();
  }
});
