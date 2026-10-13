// TEMPORARY M1 bootstrap handler.
// Replace this with M10's shared errorMiddleware during integration.
function bootstrapErrorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  const status = Number.isInteger(err.status) ? err.status : 500;
  const isProduction = process.env.NODE_ENV === "production";

  if (!isProduction) {
    console.error(`[${req.requestId || "no-request-id"}]`, err);
  } else {
    console.error(
      `[${req.requestId || "no-request-id"}] Request failed (${status})`
    );
  }

  res.status(status).json({
    success: false,
    message: status >= 500 ? "An unexpected server error occurred" : err.message,
    code: status >= 500 ? "SERVER_ERROR" : (err.code || "REQUEST_ERROR"),
    requestId: req.requestId || null
  });
}

module.exports = bootstrapErrorHandler;
