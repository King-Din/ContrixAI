
"use strict";

const mongoose = require("mongoose");

const helpArticleSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200
    },
    content: {
      type: String,
      required: true
    },
    status: {
      type: String,
      enum: ["draft", "published"],
      default: "draft"
    },
    visibility: {
      type: String,
      enum: ["public", "private"],
      default: "private"
    },
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true
    },
    snapshotId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true
    },
    path: {
      type: String,
      default: null
    },
    heading: {
      type: String,
      default: null
    },
    chunkId: {
      type: String,
      default: null
    }
  },
  {
    timestamps: true
  }
);

module.exports =
  mongoose.models.HelpArticle ||
  mongoose.model("HelpArticle", helpArticleSchema);
