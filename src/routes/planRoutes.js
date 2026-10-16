/**
 * ContrixAI — Contribution Plan Routes (M6 Lane)
 *
 * BLUEPRINT REFERENCE: ContrixAI Master Blueprint Edition 3.0 (Sections 05, 08 - M6 Taskset).
 *
 * Route surface:
 * - POST   /api/contribution-plans          — Create a contributor's proposed draft plan
 * - GET    /api/contribution-plans/:id      — Read plan and review status (owner or maintainer)
 * - PATCH  /api/contribution-plans/:id      — Edit draft or submit for review
 * - POST   /api/contribution-plans/:id/review — Maintainer records review decision
 */

const express = require("express");
const {
  createPlan,
  getPlanById,
  updatePlan,
  reviewPlan
} = require("../controllers/planController");

const router = express.Router();

// ============================================================================
// ACCESS GUARDS INTEGRATION (M4 Coordination with resilient fallback)
// ============================================================================
let protect;
let authorize;

try {
  // Check if M4 auth middleware has been merged
  const authModule = require("../middleware/authMiddleware");
  protect = authModule.protect || authModule;
} catch (e) {
  // Resilient fallback for Day 1 bootstrap & unit testing
  protect = (req, res, next) => {
    if (!req.user || (!req.user.id && !req.user._id)) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
        code: "UNAUTHENTICATED",
        requestId: req.requestId || null
      });
    }
    next();
  };
}

try {
  // Check if M4 role middleware has been merged
  const roleModule = require("../middleware/roleMiddleware");
  authorize = roleModule.authorize || roleModule;
} catch (e) {
  // Resilient fallback for Day 1 bootstrap & unit testing
  authorize = (...roles) => (req, res, next) => {
    const userRole = req.user?.role;
    const userRoles = req.user?.roles || [];
    const hasRole = roles.includes(userRole) || roles.some((r) => userRoles.includes(r));
    if (!hasRole) {
      return res.status(403).json({
        success: false,
        message: "Insufficient permissions",
        code: "FORBIDDEN",
        requestId: req.requestId || null
      });
    }
    next();
  };
}

// ============================================================================
// ROUTE DEFINITIONS
// ============================================================================

// All plan routes require an authenticated user
router.use(protect);

// Contributor draft creation
router.post("/", createPlan);

// Read plan by ID (owner or authorized project maintainer)
router.get("/:id", getPlanById);

// Update draft / needs_changes plan, or explicit submission transition
router.patch("/:id", updatePlan);

// Maintainer review of submitted plan
router.post("/:id/review", authorize("maintainer"), reviewPlan);

module.exports = router;
