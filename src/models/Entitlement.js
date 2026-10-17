"use strict";

/**
 * Entitlement Model (Deferred / Unused)
 *
 * Architectural Note (ContrixAI Edition 3.0 / Decision D4):
 * Paid subscription billing, payment tiers, and commercial entitlements
 * were part of the legacy SaaS blueprint and are explicit NON-GOALS in ContrixAI.
 * ContrixAI is an open-source contributor onboarding platform.
 *
 * This file is retained as an explicit documentation stub so that legacy references
 * fail clearly rather than creating shadow billing features.
 */

const ENTITLEMENT_STATUS = Object.freeze({
  DEFERRED: "deferred",
  NOT_APPLICABLE: "not_applicable"
});

module.exports = {
  ENTITLEMENT_STATUS,
  isEntitlementActive: () => false
};
