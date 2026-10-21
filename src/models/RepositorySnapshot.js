"use strict";
const mongoose = require("mongoose");
const repositorySnapshotSchema = new mongoose.Schema({
  projectId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  snapshotId: { type: String, required: true, trim: true, maxlength: 120 },
  sourceUrl: { type: String, trim: true, maxlength: 2048, default: "" },
  commit: { type: String, trim: true, maxlength: 100, default: "" },
  importedAt: { type: Date, required: true, default: Date.now },
  importedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  visibility: { type: String, enum: ["public", "private"], required: true, default: "public" },
  status: { type: String, enum: ["ready", "empty", "failed"], default: "ready" },
  documentCount: { type: Number, min: 0, default: 0 },
  chunkCount: { type: Number, min: 0, default: 0 },
  staleAfterDays: { type: Number, min: 1, max: 365, default: 7 }
}, { timestamps: true, strict: true });
repositorySnapshotSchema.index({ projectId: 1, snapshotId: 1 }, { unique: true });
const RepositorySnapshot = mongoose.models.RepositorySnapshot || mongoose.model("RepositorySnapshot", repositorySnapshotSchema);
module.exports = { RepositorySnapshot };
