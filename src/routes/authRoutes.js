<<<<<<< HEAD

const express = require("express");

=======
"use strict";

const express = require("express");
>>>>>>> 7d7d56b (Update project code)
const {
  signup,
  login,
  logout,
  forgotPassword,
  resetPassword,
  verifyEmail,
  me
} = require("../controllers/authController");
<<<<<<< HEAD
=======
const { loadAuthContext, requireAuth } = require("../middleware/authGuards");
>>>>>>> 7d7d56b (Update project code)

const router = express.Router();

router.post("/signup", signup);
router.post("/login", login);
router.post("/logout", logout);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.get("/verify-email", verifyEmail);
<<<<<<< HEAD
router.get("/me", me);
=======
router.get("/me", loadAuthContext, requireAuth, me);
>>>>>>> 7d7d56b (Update project code)

module.exports = router;
