"use strict";

const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");
const { z } = require("zod");
const { User } = require("../models/User");

const signupSchema = z.object({
  name: z.string({ required_error: "Name is required" }).trim().min(2, "Name must be at least 2 characters").max(80, "Name must not exceed 80 characters"),
  email: z.string({ required_error: "Email is required" }).trim().toLowerCase().email("Valid email is required").max(254),
  password: z.string({ required_error: "Password is required" }).min(8, "Password must be at least 8 characters").max(128, "Password must not exceed 128 characters"),
  skills: z.array(z.string().trim().max(40)).max(30).optional(),
  interests: z.array(z.string().trim().max(60)).max(20).optional(),
  availability: z.object({
    hoursPerWeek: z.number().min(0).max(40).optional(),
    timezone: z.string().trim().max(60).optional()
  }).optional()
});

const loginSchema = z.object({
  email: z.string({ required_error: "Email is required" }).trim().toLowerCase().email("Valid email is required"),
  password: z.string({ required_error: "Password is required" }).min(1, "Password is required")
});

const forgotPasswordSchema = z.object({
  email: z.string({ required_error: "Email is required" }).trim().toLowerCase().email("Valid email is required")
});

const resetPasswordSchema = z.object({
  token: z.string({ required_error: "Token is required" }).min(1, "Reset token is required"),
  password: z.string({ required_error: "Password is required" }).min(8, "Password must be at least 8 characters").max(128)
});

function hashToken(rawToken) {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

function formatSafeUser(user) {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    emailVerified: Boolean(user.emailVerified),
    maintainerVerified: Boolean(user.maintainerVerified),
    skills: user.skills || [],
    interests: user.interests || [],
    availability: user.availability || { hoursPerWeek: 0 }
  };
}

const signup = async (req, res, next) => {
  try {
    const validated = signupSchema.parse(req.body);
    const normalizedEmail = validated.email;

    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists",
        code: "CONFLICT",
        requestId: req.requestId || null
      });
    }

    const passwordHash = await bcrypt.hash(validated.password, 12);
    const rawVerificationToken = crypto.randomBytes(32).toString("hex");
    const verificationTokenHash = hashToken(rawVerificationToken);
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    // Public signup ALWAYS yields the contributor role. Ignore any role/verified in body.
    const newUser = await User.create({
      name: validated.name,
      email: normalizedEmail,
      passwordHash,
      role: "contributor",
      emailVerified: false,
      maintainerVerified: false,
      isActive: true,
      skills: validated.skills || [],
      interests: validated.interests || [],
      availability: validated.availability || { hoursPerWeek: 0 },
      emailVerificationTokenHash: verificationTokenHash,
      emailVerificationExpires: verificationExpires
    });

    return res.status(201).json({
      success: true,
      data: {
        user: formatSafeUser(newUser)
      },
      meta: {
        requestId: req.requestId || null
      }
    });
  } catch (error) {
    return next(error);
  }
};

const login = async (req, res, next) => {
  try {
    const validated = loginSchema.parse(req.body);
    const normalizedEmail = validated.email;

    const user = await User.findOne({ email: normalizedEmail }).select("+passwordHash");

    // Generic error for wrong email or wrong password to prevent user enumeration
    const genericAuthError = () =>
      res.status(401).json({
        success: false,
        message: "Invalid email or password",
        code: "UNAUTHENTICATED",
        requestId: req.requestId || null
      });

    if (!user || !user.passwordHash) {
      return genericAuthError();
    }

    const isMatch = await bcrypt.compare(validated.password, user.passwordHash);
    if (!isMatch) {
      return genericAuthError();
    }

    if (user.isActive === false) {
      return res.status(401).json({
        success: false,
        message: "Account is inactive",
        code: "UNAUTHENTICATED",
        requestId: req.requestId || null
      });
    }

    // Server-side session establishment
    if (req.session) {
      req.session.userId = String(user._id);
      if (!req.session.csrfToken) {
        req.session.csrfToken = crypto.randomBytes(32).toString("hex");
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        user: formatSafeUser(user),
        csrfToken: req.session ? req.session.csrfToken : undefined
      },
      meta: {
        requestId: req.requestId || null
      }
    });
  } catch (error) {
    return next(error);
  }
};

const logout = async (req, res, next) => {
  try {
    if (req.session) {
      req.session.destroy((err) => {
        if (err) return next(err);
        res.clearCookie("connect.sid");
        return res.status(200).json({
          success: true,
          data: { message: "Logged out successfully" },
          meta: { requestId: req.requestId || null }
        });
      });
    } else {
      return res.status(200).json({
        success: true,
        data: { message: "Logged out successfully" },
        meta: { requestId: req.requestId || null }
      });
    }
  } catch (error) {
    return next(error);
  }
};

const forgotPassword = async (req, res, next) => {
  try {
    const validated = forgotPasswordSchema.parse(req.body);
    const normalizedEmail = validated.email;

    const user = await User.findOne({ email: normalizedEmail });
    if (user && user.isActive !== false) {
      const rawToken = crypto.randomBytes(32).toString("hex");
      user.resetPasswordTokenHash = hashToken(rawToken);
      user.resetPasswordTokenExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
      await user.save();
    }

    // Identical response whether email exists or not to prevent account enumeration
    return res.status(200).json({
      success: true,
      data: {
        message: "If the account exists, a password reset link has been sent"
      },
      meta: {
        requestId: req.requestId || null
      }
    });
  } catch (error) {
    return next(error);
  }
};

const resetPassword = async (req, res, next) => {
  try {
    const validated = resetPasswordSchema.parse(req.body);
    const tokenHash = hashToken(validated.token);

    const user = await User.findOne({
      resetPasswordTokenHash: tokenHash,
      resetPasswordTokenExpires: { $gt: new Date() }
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired password reset token",
        code: "VALIDATION_ERROR",
        requestId: req.requestId || null
      });
    }

    user.passwordHash = await bcrypt.hash(validated.password, 12);
    user.resetPasswordTokenHash = undefined;
    user.resetPasswordTokenExpires = undefined;
    await user.save();

    if (req.session && typeof req.session.destroy === "function") {
      req.session.destroy(() => {});
    }

    return res.status(200).json({
      success: true,
      data: {
        message: "Password reset successful"
      },
      meta: {
        requestId: req.requestId || null
      }
    });
  } catch (error) {
    return next(error);
  }
};

const verifyEmail = async (req, res, next) => {
  try {
    const token = req.query.token;
    if (!token || typeof token !== "string") {
      return res.status(400).json({
        success: false,
        message: "Verification token is required",
        code: "VALIDATION_ERROR",
        requestId: req.requestId || null
      });
    }

    const tokenHash = hashToken(token);
    const user = await User.findOne({
      emailVerificationTokenHash: tokenHash,
      emailVerificationExpires: { $gt: new Date() }
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired verification token",
        code: "VALIDATION_ERROR",
        requestId: req.requestId || null
      });
    }

    user.emailVerified = true;
    user.emailVerificationTokenHash = undefined;
    user.emailVerificationExpires = undefined;
    await user.save();

    return res.status(200).json({
      success: true,
      data: {
        message: "Email verified successfully"
      },
      meta: {
        requestId: req.requestId || null
      }
    });
  } catch (error) {
    return next(error);
  }
};

const me = async (req, res, next) => {
  try {
    if (!req.auth || !req.auth.userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication is required",
        code: "UNAUTHENTICATED",
        requestId: req.requestId || null
      });
    }

    const user = await User.findById(req.auth.userId);
    if (!user || user.isActive === false) {
      return res.status(401).json({
        success: false,
        message: "Authentication is required",
        code: "UNAUTHENTICATED",
        requestId: req.requestId || null
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        user: formatSafeUser(user),
        csrfToken: req.session ? req.session.csrfToken : undefined
      },
      meta: {
        requestId: req.requestId || null
      }
    });
  } catch (error) {
    return next(error);
  }
};

const updateProfile = async (req, res, next) => {
  try {
    if (!req.auth || !req.auth.userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication is required",
        code: "UNAUTHENTICATED",
        requestId: req.requestId || null
      });
    }

    const user = await User.findById(req.auth.userId);
    if (!user || user.isActive === false) {
      return res.status(401).json({
        success: false,
        message: "Authentication is required",
        code: "UNAUTHENTICATED",
        requestId: req.requestId || null
      });
    }

    const { pickProfileUpdates } = require("../models/User");
    const updates = pickProfileUpdates(req.body);
    if (updates.name) user.name = updates.name;
    if (Array.isArray(updates.skills)) user.skills = updates.skills.slice(0, 30);
    if (Array.isArray(updates.interests)) user.interests = updates.interests.slice(0, 20);
    if (updates.availability) {
      if (typeof updates.availability.hoursPerWeek === "number") {
        user.availability.hoursPerWeek = Math.min(40, Math.max(0, updates.availability.hoursPerWeek));
      }
      if (updates.availability.timezone) user.availability.timezone = updates.availability.timezone;
    }

    await user.save();

    return res.status(200).json({
      success: true,
      data: {
        user: formatSafeUser(user)
      },
      meta: {
        requestId: req.requestId || null
      }
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  signup,
  login,
  logout,
  forgotPassword,
  resetPassword,
  verifyEmail,
  me,
  updateProfile
};

