"use strict";

const ERROR_DEFINITIONS = Object.freeze({
  VALIDATION_ERROR: { status: 400, message: "Request data is invalid" },
  INVALID_JSON: { status: 400, message: "Request body contains invalid JSON" },
  UNAUTHENTICATED: { status: 401, message: "Authentication is required" },
  NO_TOKEN: { status: 401, message: "Authentication is required" },
  FORBIDDEN: { status: 403, message: "You do not have permission to perform this action" },
  NOT_FOUND: { status: 404, message: "The requested resource was not found" },
  CONFLICT: { status: 409, message: "The request conflicts with the current resource state" },
  RATE_LIMITED: { status: 429, message: "Too many requests. Please try again later." },
  AI_UNAVAILABLE: { status: 503, message: "The AI service is temporarily unavailable" },
  RETRIEVAL_NO_EVIDENCE: { status: 200, message: "No supporting documentation was found" },
  SERVER_ERROR: { status: 500, message: "An unexpected server error occurred" }
});

function normalizeError(err) {
  if (err instanceof SyntaxError && err.status === 400 && Object.prototype.hasOwnProperty.call(err, "body")) {
    return { status: 400, code: "INVALID_JSON", message: ERROR_DEFINITIONS.INVALID_JSON.message };
  }
  if (err && (err.name === "ZodError" || err.name === "ValidationError" || err.name === "CastError")) {
    return { status: 400, code: "VALIDATION_ERROR", message: ERROR_DEFINITIONS.VALIDATION_ERROR.message };
  }
  if (err && (err.code === 11000 || err.status === 409 || err.statusCode === 409)) {
    return { status: 409, code: "CONFLICT", message: ERROR_DEFINITIONS.CONFLICT.message };
  }
  if (err && (err.status === 429 || err.statusCode === 429 || err.code === "RATE_LIMITED")) {
    return { status: 429, code: "RATE_LIMITED", message: ERROR_DEFINITIONS.RATE_LIMITED.message };
  }
  if (err && ["AI_UNAVAILABLE", "ECONNREFUSED", "ETIMEDOUT", "TimeoutError", "AbortError"].some((value) => value === err.code || value === err.name)) {
    return { status: 503, code: "AI_UNAVAILABLE", message: ERROR_DEFINITIONS.AI_UNAVAILABLE.message };
  }

  const statusCandidate = Number(err && (err.statusCode || err.status));
  const codeCandidate = err && typeof err.code === "string" ? err.code : "";
  if (codeCandidate === "RETRIEVAL_NO_EVIDENCE") {
    return { status: 200, code: codeCandidate, message: ERROR_DEFINITIONS.RETRIEVAL_NO_EVIDENCE.message };
  }
  if (Object.prototype.hasOwnProperty.call(ERROR_DEFINITIONS, codeCandidate)) {
    const definition = ERROR_DEFINITIONS[codeCandidate];
    return { status: definition.status, code: codeCandidate, message: definition.message };
  }
  if (statusCandidate === 401) return { ...ERROR_DEFINITIONS.UNAUTHENTICATED, code: "UNAUTHENTICATED" };
  if (statusCandidate === 403) return { ...ERROR_DEFINITIONS.FORBIDDEN, code: "FORBIDDEN" };
  if (statusCandidate === 404) return { ...ERROR_DEFINITIONS.NOT_FOUND, code: "NOT_FOUND" };
  if (statusCandidate === 400) return { ...ERROR_DEFINITIONS.VALIDATION_ERROR, code: "VALIDATION_ERROR" };

  return { ...ERROR_DEFINITIONS.SERVER_ERROR, code: "SERVER_ERROR" };
}

function errorMiddleware(err, req, res, next) {
  if (res.headersSent) return next(err);

  try {
    const normalized = normalizeError(err || {});
    if (normalized.status >= 500) {
      // Log only a request identifier and stable code, never secrets, payloads or stack traces.
      console.error(`[${req.requestId || "no-request-id"}] ${normalized.code}`);
    }
    return res.status(normalized.status).json({
      success: normalized.status < 400,
      ...(normalized.status < 400 ? { data: { message: normalized.message } } : { message: normalized.message }),
      code: normalized.code,
      requestId: req.requestId || null
    });
  } catch (_handlerError) {
    if (res.headersSent) return next(_handlerError);
    return res.status(500).json({
      success: false,
      message: ERROR_DEFINITIONS.SERVER_ERROR.message,
      code: "SERVER_ERROR",
      requestId: req.requestId || null
    });
  }
}

module.exports = { errorMiddleware, normalizeError, ERROR_DEFINITIONS };
