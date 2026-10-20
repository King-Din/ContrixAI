"use strict";

const mongoose = require("mongoose");

const membershipSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  // Project identifiers are stable strings in the current seed/Plan contract.
  projectId: { type: String, required: true, trim: true },
  role: { type: String, enum: ["maintainer", "contributor"], required: true },
  status: { type: String, enum: ["active", "invited", "revoked"], default: "invited", required: true },
  invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  verifiedAt: { type: Date }
}, { timestamps: true, strict: "throw" });

membershipSchema.index({ userId: 1, projectId: 1 }, { unique: true, name: "membership_user_project_unique" });

const Membership = mongoose.models.Membership || mongoose.model("Membership", membershipSchema);
module.exports = { Membership };
