const mongoose = require("mongoose");

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
        "verified_maintainer",
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

module.exports = { User, PROFILE_FIELDS };
