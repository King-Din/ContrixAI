"use strict";

const mongoose = require("mongoose");

const helpArticleSchema = new mongoose.Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      required: true,
      index: true
    },
    snapshotId: {
      type: String,
      required: true,
      index: true,
      trim: true
    },
    chunkId: {
      type: String,
      trim: true,
      index: true
    },
    path: {
      type: String,
      required: true,
      trim: true
    },
    heading: {
      type: String,
      required: true,
      trim: true
    },
    content: {
      type: String,
      required: true
    },
    visibility: {
      type: String,
      enum: ["public", "private"],
      default: "public",
      index: true
    },
    status: {
      type: String,
      enum: ["draft", "published", "stale"],
      default: "published",
      index: true
    },
    staleReason: {
      type: String,
      trim: true
    },
    tags: [
      {
        type: String,
        trim: true
      }
    ]
  },
  {
    timestamps: true,
    strict: true
  }
);

helpArticleSchema.index({ projectId: 1, visibility: 1, status: 1 });

const HelpArticle = mongoose.models.HelpArticle || mongoose.model("HelpArticle", helpArticleSchema);

module.exports = { HelpArticle };
