"use strict";

function createHttpError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

/*
 * M2's authentication layer must set req.session.userId after successful login.
 * The session is server-side; never build identity from req.body, query params,
 * or caller-supplied role/userId headers.
 */
async function loadAuthContext(req, res, next) {
  try {
    if (!req.session || !req.session.userId) {
      return next(createHttpError(401, "UNAUTHENTICATED", "Authentication is required"));
    }

    const { User } = require("../models/User");
    const user = await User.findById(req.session.userId)
      .select("name email role emailVerified maintainerVerified isActive")
      .lean();

    if (!user || user.isActive === false) {
      if (req.session && typeof req.session.destroy === "function") {
        req.session.destroy(() => {});
      }
      return next(createHttpError(401, "UNAUTHENTICATED", "Authentication is required"));
    }

    req.auth = Object.freeze({
      userId: String(user._id),
      role: user.role,
      emailVerified: Boolean(user.emailVerified),
      maintainerVerified: Boolean(user.maintainerVerified),
      name: user.name,
      email: user.email
    });
    return next();
  } catch (error) {
    return next(error);
  }
}

function requireAuth(req, res, next) {
  if (!req.auth || !req.auth.userId) {
    return next(createHttpError(401, "UNAUTHENTICATED", "Authentication is required"));
  }
  return next();
}

function requireRole(...allowedRoles) {
  const roles = new Set(allowedRoles.flat());
  return function roleGuard(req, res, next) {
    if (!req.auth || !req.auth.userId) {
      return next(createHttpError(401, "UNAUTHENTICATED", "Authentication is required"));
    }
    if (!roles.has(req.auth.role)) {
      return next(createHttpError(403, "FORBIDDEN", "You do not have permission to perform this action"));
    }
    return next();
  };
}

/*
 * Project membership is owned by M5. Inject a checker that uses the final M5
 * membership/grant schema. Failing closed prevents access while that contract
 * is unavailable; it never trusts project IDs or roles supplied by the client.
 *
 * checker signature: async ({ userId, projectId, roles, userRole }) => boolean
 */
function requireProjectAccess({ getProjectId = (req) => req.params.projectId || req.params.id, roles = [] } = {}) {
  return async function projectAccessGuard(req, res, next) {
    if (!req.auth || !req.auth.userId) {
      return next(createHttpError(401, "UNAUTHENTICATED", "Authentication is required"));
    }
    const projectId = getProjectId(req);
    if (typeof projectId !== "string" || !projectId.trim()) {
      return next(createHttpError(400, "VALIDATION_ERROR", "A valid project identifier is required"));
    }

    const checker = req.app && req.app.locals && req.app.locals.checkProjectAccess;
    if (typeof checker !== "function") {
      return next(createHttpError(500, "SERVER_ERROR", "Project access checks are not configured"));
    }

    try {
      const allowed = await checker({
        userId: req.auth.userId,
        projectId,
        roles,
        userRole: req.auth.role
      });
      if (!allowed) {
        return next(createHttpError(403, "FORBIDDEN", "You do not have permission to access this project"));
      }
      req.projectAccess = Object.freeze({ projectId });
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

function requireCsrf(req, res, next) {
  const method = String(req.method || "GET").toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return next();
  const sessionToken = req.session && req.session.csrfToken;
  const headerToken = req.get ? req.get("x-csrf-token") : (req.headers && req.headers["x-csrf-token"]);
  if (typeof sessionToken !== "string" || typeof headerToken !== "string" || !sessionToken || !headerToken) {
    return next(createHttpError(403, "FORBIDDEN", "A valid CSRF token is required"));
  }
  const crypto = require("node:crypto");
  const sessionBuffer = Buffer.from(sessionToken);
  const headerBuffer = Buffer.from(headerToken);
  if (sessionBuffer.length !== headerBuffer.length || !crypto.timingSafeEqual(sessionBuffer, headerBuffer)) {
    return next(createHttpError(403, "FORBIDDEN", "A valid CSRF token is required"));
  }
  return next();
}

function requireVerifiedEmail(req, res, next) {
  if (!req.auth || !req.auth.userId) {
    return next(createHttpError(401, "UNAUTHENTICATED", "Authentication is required"));
  }
  if (!req.auth.emailVerified) {
    return next(createHttpError(403, "FORBIDDEN", "Verify your email before performing this action"));
  }
  return next();
}

function requireVerifiedMaintainer(req, res, next) {
  if (!req.auth || !req.auth.userId) {
    return next(createHttpError(401, "UNAUTHENTICATED", "Authentication is required"));
  }
  if (req.auth.role !== "maintainer" || !req.auth.maintainerVerified) {
    return next(createHttpError(403, "FORBIDDEN", "Verified maintainer access is required"));
  }
  return next();
}

module.exports = {
  loadAuthContext,
  requireAuth,
  requireRole,
  requireProjectAccess,
  requireCsrf,
  requireVerifiedEmail,
  requireVerifiedMaintainer,
  createHttpError
};
