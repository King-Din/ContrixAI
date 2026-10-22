"use strict";

const mongoose = require("mongoose");

const projectSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 120
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true
    },
    description: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: ""
    },
    visibility: {
      type: String,
      enum: ["public", "private"],
      default: "public"
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "ready"],
      default: "approved"
    },
    approved: {
      type: Boolean,
      default: true
    },
    maintainerIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
      }
    ],
    verifiedState: {
      type: String,
      default: "verified"
    },
    repositoryUrl: {
      type: String,
      trim: true
    }
  },
  {
    timestamps: true,
    strict: true
  }
);

projectSchema.index({ visibility: 1, status: 1 });

const Project = mongoose.models.Project || mongoose.model("Project", projectSchema);

module.exports = { Project };
