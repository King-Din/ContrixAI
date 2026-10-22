"use strict";

const express = require("express");
const {
  signup,
  login,
  logout,
  forgotPassword,
  resetPassword,
  verifyEmail,
  me,
  updateProfile
} = require("../controllers/authController");
const { loadAuthContext, requireAuth } = require("../middleware/authGuards");

const router = express.Router();

router.post("/signup", signup);
router.post("/login", login);
router.post("/logout", logout);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.get("/verify-email", verifyEmail);
router.get("/me", loadAuthContext, requireAuth, me);
router.patch("/profile", loadAuthContext, requireAuth, updateProfile);

module.exports = router;
