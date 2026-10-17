<<<<<<< HEAD
﻿const mongoose = require("mongoose");
=======
const mongoose = require("mongoose");
>>>>>>> 7d7d56b (Update project code)

const PROFILE_FIELDS = Object.freeze([
  "name",
  "skills",
  "interests",
  "availability",
]);

const availabilitySchema = new mongoose.Schema(
  {
    hoursPerWeek: {
      type: Number,
      min: 0,
      max: 40,
      default: 0,
    },
    timezone: {
      type: String,
      trim: true,
      maxlength: 60,
    },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 80,
    },

    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },

    passwordHash: {
      type: String,
      required: true,
      select: false,
    },

    role: {
      type: String,
      enum: [
        "contributor",
        "maintainer",
<<<<<<< HEAD
        "verified_maintainer",
=======
>>>>>>> 7d7d56b (Update project code)
        "moderator",
      ],
      default: "contributor",
      required: true,
    },

    emailVerified: {
      type: Boolean,
      default: false,
    },

    maintainerVerified: {
      type: Boolean,
      default: false,
    },

    isActive: {
      type: Boolean,
      default: true,
    },

<<<<<<< HEAD
=======
    emailVerificationTokenHash: {
      type: String,
      select: false,
    },

    emailVerificationExpires: {
      type: Date,
      select: false,
    },

    resetPasswordTokenHash: {
      type: String,
      select: false,
    },

    resetPasswordTokenExpires: {
      type: Date,
      select: false,
    },

>>>>>>> 7d7d56b (Update project code)
    skills: {
      type: [
        {
          type: String,
          trim: true,
          maxlength: 40,
        },
      ],
      default: [],
      validate: {
        validator: (items) => items.length <= 30,
        message: "Maximum 30 skills allowed.",
      },
    },

    interests: {
      type: [
        {
          type: String,
          trim: true,
          maxlength: 60,
        },
      ],
      default: [],
      validate: {
        validator: (items) => items.length <= 20,
        message: "Maximum 20 interests allowed.",
      },
    },

    availability: {
      type: availabilitySchema,
      default: () => ({}),
    },
  },
  {
    timestamps: true,
    strict: true,
  }
);

userSchema.index(
  { email: 1 },
  { unique: true, name: "user_email_unique" }
);

userSchema.index(
  { role: 1 },
  { name: "user_role_index" }
);

const User = mongoose.model("User", userSchema);

<<<<<<< HEAD
module.exports = { User, PROFILE_FIELDS };
=======
// Only these fields may be changed by a contributor profile update.
// Security-sensitive fields (role, verification flags, isActive, passwordHash)
// are deliberately excluded even if the caller supplies them.
function pickProfileUpdates(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const updates = {};
  for (const field of PROFILE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(input, field)) updates[field] = input[field];
  }
  return updates;
}

module.exports = { User, PROFILE_FIELDS, pickProfileUpdates };
>>>>>>> 7d7d56b (Update project code)
