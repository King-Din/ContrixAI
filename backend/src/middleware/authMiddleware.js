"use strict";
const crypto = require("node:crypto");
const mongoose = require("mongoose");
const { httpError } = require("./roleMiddleware");

async function resolveAuth(req) {
  const id = req.session && req.session.userId;
  if (!id || !mongoose.isValidObjectId(id)) return null;
  const { User } = require("../models/User");
  const u = await User.findById(id).select("name email role emailVerified maintainerVerified isActive").lean();
  if (!u || u.isActive === false) {
    if (req.session && typeof req.session.destroy === "function") req.session.destroy(() => {});
    return null;
  }
  return Object.freeze({ userId: String(u._id), role: u.role, name: u.name, email: u.email,
    emailVerified: Boolean(u.emailVerified), maintainerVerified: Boolean(u.maintainerVerified) });
}

const protect = async (req, res, next) => {
  try {
    const auth = await resolveAuth(req);
    if (!auth) return next(httpError(401, "UNAUTHENTICATED", "Authentication is required"));
    req.auth = auth; req.user = auth; // req.auth is canonical (M2 and M6 read it)
    return next();
  } catch (e) { return next(e); }
};

const optionalProtect = async (req, res, next) => {
  try {
    const auth = await resolveAuth(req);
    if (auth) { req.auth = auth; req.user = auth; }
    return next();
  } catch (e) { return next(e); }
};

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);
const csrfProtect = (req, res, next) => {
  if (SAFE.has(String(req.method).toUpperCase())) return next();
  if (!(req.session && req.session.userId)) return next(); // not cookie-authenticated yet (signup/login)
  const a = req.session.csrfToken, b = req.get("x-csrf-token");
  const ok = typeof a === "string" && typeof b === "string" && a.length === b.length &&
    crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  return ok ? next() : next(httpError(403, "FORBIDDEN", "A valid CSRF token is required"));
};

module.exports = { protect, optionalProtect, csrfProtect,
  loadAuthContext: protect, requireAuth: (req, res, next) => next() }; // aliases for existing routes