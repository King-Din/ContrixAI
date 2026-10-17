
const express = require("express");

const {
  signup,
  login,
  logout,
  forgotPassword,
  resetPassword,
  verifyEmail,
  me
} = require("../controllers/authController");

const router = express.Router();

router.post("/signup", signup);
router.post("/login", login);
router.post("/logout", logout);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.get("/verify-email", verifyEmail);
router.get("/me", me);

module.exports = router;
