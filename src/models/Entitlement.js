/**
 * ContrixAI — Entitlement Model Compatibility Stub (M6 Lane)
 *
 * BLUEPRINT REFERENCE: ContrixAI Master Blueprint Edition 3.0 (Sections 01, 07, 08).
 *
 * NOTE: Commercial entitlements, subscription billing, and payment tiers from the
 * legacy SaaS blueprint are explicit non-goals in ContrixAI.
 * This file is retained exclusively as a compatibility slot and is marked as
 * DEFERRED / UNUSED.
 */

const mongoose = require("mongoose");

const EntitlementSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      default: "deprecated",
      enum: ["deprecated", "unused"]
    },
    note: {
      type: String,
      default: "Entitlements are deferred/unused in ContrixAI Blueprint Edition 3.0"
    }
  },
  {
    timestamps: true
  }
);

// Prevent accidental writes or commercial usage
EntitlementSchema.pre("save", function (next) {
  const error = new Error(
    "Entitlement operations are disabled. Commercial entitlements are not part of ContrixAI."
  );
  error.code = "FEATURE_DEFERRED";
  error.status = 501;
  next(error);
});

const Entitlement =
  mongoose.models.Entitlement ||
  mongoose.model("Entitlement", EntitlementSchema);

module.exports = {
  Entitlement,
  isDeferred: true,
  message: "Commercial entitlements are deferred/unused in ContrixAI Blueprint Edition 3.0."
};
