"use strict";

const mongoose = require("mongoose");

const toolInvocationSchema = new mongoose.Schema(
  {
    tool: {
      type: String,
      required: true,
      trim: true
    },
    input: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    outputSummary: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    timestamp: {
      type: Date,
      default: Date.now
    }
  },
  { _id: false }
);

const agentRunSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    projectId: {
      type: String,
      required: true,
      index: true
    },
    snapshotId: {
      type: String,
      trim: true
    },
    toolSequence: {
      type: [toolInvocationSchema],
      default: []
    },
    status: {
      type: String,
      enum: ["success", "failed", "degraded"],
      default: "success",
      index: true
    },
    latency: {
      type: Number,
      min: 0,
      default: 0
    },
    references: [
      {
        type: String,
        trim: true
      }
    ],
    safeDiagnostics: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  {
    timestamps: true,
    strict: true
  }
);

agentRunSchema.index({ userId: 1, createdAt: -1 });
agentRunSchema.index({ projectId: 1, createdAt: -1 });

const AgentRun = mongoose.models.AgentRun || mongoose.model("AgentRun", agentRunSchema);

module.exports = { AgentRun };
