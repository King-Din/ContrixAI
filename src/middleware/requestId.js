const { randomUUID } = require("node:crypto");

function requestId(req, res, next) {
  const suppliedId = req.get("x-request-id");
  // Keep client-provided IDs short and safe; otherwise create one server-side.
  const safeSuppliedId =
    typeof suppliedId === "string" &&
    suppliedId.length <= 100 &&
    /^[A-Za-z0-9._:-]+$/.test(suppliedId);

  req.requestId = safeSuppliedId ? suppliedId : randomUUID();
  res.setHeader("X-Request-ID", req.requestId);
  next();
}

module.exports = requestId;
