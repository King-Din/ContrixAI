"use strict";
const mongoose = require("mongoose");
const documentChunkSchema = new mongoose.Schema({
  projectId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  snapshotId: { type: String, required: true, index: true, maxlength: 120 },
  visibility: { type: String, enum: ["public", "private"], required: true, index: true },
  path: { type: String, required: true, trim: true, maxlength: 300 },
  heading: { type: String, trim: true, maxlength: 300, default: "" },
  chunkId: { type: String, required: true, unique: true, index: true },
  content: { type: String, required: true, maxlength: 12000 },
  contentHash: { type: String, required: true, maxlength: 64 },
  embedding: { type: [Number], default: undefined, select: false },
  importedAt: { type: Date, required: true, default: Date.now }
}, { timestamps: true, strict: true });
documentChunkSchema.index({ projectId: 1, snapshotId: 1, visibility: 1 });
const DocumentChunk = mongoose.models.DocumentChunk || mongoose.model("DocumentChunk", documentChunkSchema);
module.exports = { DocumentChunk };
