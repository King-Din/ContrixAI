"use strict";

function errorMiddleware(err, req, res, next) {
  if (res.headersSent) return next(err);

  try {
    let status = Number(err.statusCode || err.status) || 500;
    let code = typeof err.code === "string" ? err.code : "SERVER_ERROR";
    let message = typeof err.message === "string" ? err.message : "An unexpected server error occurred";

    if (err instanceof SyntaxError && err.status === 400 && Object.prototype.hasOwnProperty.call(err, "body")) {
      status = 400;
      code = "INVALID_JSON";
      message = "Request body contains invalid JSON";
    } else if (["ZodError", "ValidationError", "CastError"].includes(err.name)) {
      status = 400;
      code = "VALIDATION_ERROR";
      message = "Request data is invalid";
    } else if (err.code === 11000) {
      status = 409;
      code = "CONFLICT";
      message = "A record with this value already exists";
    } else if (status === 429 || err.code === "RATE_LIMITED") {
      status = 429;
      code = "RATE_LIMITED";
      message = "Too many requests. Please try again later.";
    } else if (
      err.code === "AI_UNAVAILABLE" ||
      err.code === "ECONNREFUSED" ||
      err.name === "TimeoutError" ||
      err.name === "AbortError"
    ) {
      status = 503;
      code = "AI_UNAVAILABLE";
      message = "The AI service is temporarily unavailable";
    } else if (status >= 500 || status < 400) {
      status = 500;
      code = "SERVER_ERROR";
      message = "An unexpected server error occurred";
    } else {
      if (status === 401) {
        code = "UNAUTHENTICATED";
        message = "Authentication is required";
      } else if (status === 403) {
        code = "FORBIDDEN";
        message = "You do not have permission to perform this action";
      } else if (status === 404) {
        code = "NOT_FOUND";
        message = "The requested resource was not found";
      } else if (!err.code || code === "SERVER_ERROR") {
        code = "REQUEST_ERROR";
      }
    }

    const payload = {
      success: false,
      message,
      code,
      requestId: req.requestId || null
    };

    if (process.env.NODE_ENV === "development" && status >= 500 && err.stack) {
      payload.stack = err.stack;
    }

    if (status >= 500) {
      console.error(`[${req.requestId || "no-request-id"}] ${code}`);
    }

    return res.status(status).json(payload);
  } catch (handlerError) {
    if (res.headersSent) return next(handlerError);
    try {
      return res.status(500).json({
        success: false,
        message: "An unexpected server error occurred",
        code: "SERVER_ERROR",
        requestId: req.requestId || null
      });
    } catch (fallbackError) {
      return next(fallbackError);
    }
  }
}

module.exports = errorMiddleware;