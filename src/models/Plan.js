"use strict";

const mongoose = require("mongoose");

const STATUS_TRANSITIONS = Object.freeze({
  draft: ["submitted"],
  submitted: ["approved", "rejected", "needs_changes"],
  needs_changes: ["submitted"],
  approved: [],
  rejected: []
});

const stepSchema = new mongoose.Schema(
  {
    order: {
      type: Number,
      required: true,
      min: 1
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200
    },
    detail: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: ""
    }
  },
  { _id: false }
);

const evidenceRefSchema = new mongoose.Schema(
  {
    chunkId: {
      type: String,
      required: true,
      trim: true
    },
    snapshotId: {
      type: String,
      required: true,
      trim: true
    },
    snapshotVersion: {
      type: String,
      trim: true
    },
    path: {
      type: String,
      required: true,
      trim: true
    },
    heading: {
      type: String,
      trim: true
    }
  },
  { _id: false }
);

const statusHistorySchema = new mongoose.Schema(
  {
    from: {
      type: String,
      enum: [null, "draft", "submitted", "needs_changes", "approved", "rejected"],
      default: null
    },
    to: {
      type: String,
      enum: ["draft", "submitted", "needs_changes", "approved", "rejected"],
      required: true
    },
    changedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    changedAt: {
      type: Date,
      default: Date.now
    },
    reason: {
      type: String,
      trim: true,
      maxlength: 500
    }
  },
  { _id: false }
);

const planSchema = new mongoose.Schema(
  {
    contributorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    projectId: {
      type: String,
      required: true,
      trim: true
    },
    issueId: {
      type: String,
      required: true,
      trim: true
    },
    approach: {
      type: String,
      required: true,
      trim: true,
      minlength: 10,
      maxlength: 4000
    },
    steps: {
      type: [stepSchema],
      required: true,
      validate: {
        validator: (items) => Array.isArray(items) && items.length > 0,
        message: "At least one plan step is required."
      }
    },
    evidenceRefs: {
      type: [evidenceRefSchema],
      default: []
    },
    status: {
      type: String,
      enum: ["draft", "submitted", "needs_changes", "approved", "rejected"],
      default: "draft",
      required: true
    },
    reviewerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },
    feedback: {
      type: String,
      trim: true,
      maxlength: 2000
    },
    submittedAt: {
      type: Date
    },
    reviewedAt: {
      type: Date
    },
    statusHistory: {
      type: [statusHistorySchema],
      default: []
    }
  },
  {
    timestamps: true,
    strict: true
  }
);

planSchema.index({ contributorId: 1, status: 1 });
planSchema.index({ projectId: 1, status: 1 });
planSchema.index({ issueId: 1 });

const Plan = mongoose.model("Plan", planSchema);

module.exports = {
  Plan,
  ContributionPlan: Plan,
  STATUS_TRANSITIONS
};
