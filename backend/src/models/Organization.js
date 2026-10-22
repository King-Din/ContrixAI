"use strict";

const mongoose = require("mongoose");

/**
 * Organization Model
 *
 * Architectural Note (ContrixAI Edition 3.0 / Decision D4):
 * ContrixAI scopes maintainers and contributors at the Project level.
 * Organization is preserved for maintainer grouping / organizational tenancy
 * and backward compatibility with earlier SaaS specifications.
 */
const organizationSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 100
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
      maxlength: 500
    },
    maintainerIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
      }
    ],
    isActive: {
      type: Boolean,
      default: true
    }
  },
  {
    timestamps: true,
    strict: true
  }
);

const Organization = mongoose.model("Organization", organizationSchema);

module.exports = { Organization };
