"use strict";

/**
 * Architectural Note (ContrixAI Edition 3.0 / Decision D4):
 * - Ticket is reinterpreted as the Issue domain model (Ticket -> Issue).
 * - M6 (planController.reviewPlan) looks up `mongoose.models.Issue || mongoose.models.Ticket`
 *   and relies on fields `status` and `assigneeId`.
 * - The primary model name registered with Mongoose is "Issue", explicitly backed
 *   by collection "issues". "Ticket" is exported as an identical alias.
 * - IssueInterest is exported as a second model from this file, backed by collection
 *   "issueinterests", with a partial unique index on active interest.
 */

const mongoose = require("mongoose");

const ISSUE_STATUS = Object.freeze({
  OPEN: "open",
  ASSIGNED: "assigned",
  CLOSED: "closed"
});

const ISSUE_STATUS_TRANSITIONS = Object.freeze({
  open: ["assigned"],
  assigned: ["open", "closed"],
  closed: []
});

const prerequisiteSchema = new mongoose.Schema(
  {
    label: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80
    },
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000
    },
    docRef: {
      type: String,
      trim: true,
      maxlength: 300,
      default: undefined
    }
  },
  { _id: false }
);

const issueSchema = new mongoose.Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      required: true
    },
    sourceId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100
    },
    title: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 200
    },
    body: {
      type: String,
      trim: true,
      maxlength: 20000,
      default: ""
    },
    labels: {
      type: [
        {
          type: String,
          trim: true,
          maxlength: 40
        }
      ],
      default: [],
      validate: {
        validator: (items) => Array.isArray(items) && items.length <= 20,
        message: "Maximum 20 labels allowed."
      }
    },
    requirements: {
      type: [
        {
          type: String,
          trim: true,
          maxlength: 300
        }
      ],
      default: [],
      validate: {
        validator: (items) => Array.isArray(items) && items.length <= 20,
        message: "Maximum 20 requirements allowed."
      }
    },
    prerequisites: {
      type: [prerequisiteSchema],
      default: [],
      validate: {
        validator: (items) => Array.isArray(items) && items.length <= 20,
        message: "Maximum 20 prerequisites allowed."
      }
    },
    status: {
      type: String,
      enum: ["open", "assigned", "closed"],
      default: "open",
      required: true
    },
    assigneeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    },
    sourceVersion: {
      type: String,
      trim: true,
      maxlength: 100,
      default: null
    },
    snapshotId: {
      type: String,
      trim: true,
      maxlength: 100,
      default: null
    }
  },
  {
    timestamps: true,
    strict: true
  }
);

issueSchema.index({ projectId: 1, status: 1 });
issueSchema.index({ projectId: 1, sourceId: 1 }, { unique: true });
issueSchema.index({ labels: 1 });

const issueInterestSchema = new mongoose.Schema(
  {
    issueId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Issue",
      required: true
    },
    contributorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      required: true
    },
    status: {
      type: String,
      enum: ["active", "withdrawn"],
      default: "active",
      required: true
    }
  },
  {
    timestamps: true,
    strict: true
  }
);

issueInterestSchema.index(
  { issueId: 1, contributorId: 1 },
  { unique: true, partialFilterExpression: { status: "active" } }
);
issueInterestSchema.index({ projectId: 1, status: 1 });
issueInterestSchema.index({ contributorId: 1, status: 1 });

const Issue = mongoose.models.Issue || mongoose.model("Issue", issueSchema, "issues");
const Ticket = Issue;
const IssueInterest = mongoose.models.IssueInterest || mongoose.model("IssueInterest", issueInterestSchema, "issueinterests");

module.exports = {
  Issue,
  Ticket,
  IssueInterest,
  ISSUE_STATUS,
  ISSUE_STATUS_TRANSITIONS
};
