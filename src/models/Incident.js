"use strict";

const mongoose = require("mongoose");

// ASSUMPTION(M9->team): PROPOSED severity levels (keep in ONE constant)
const INCIDENT_SEVERITY = Object.freeze(["minor", "major", "critical"]);

// ASSUMPTION(M9->team): PROPOSED component list (keep in ONE constant)
const INCIDENT_COMPONENTS = Object.freeze(["api", "database", "model", "retrieval", "snapshot"]);

// FIXED by blueprint: status enum ["investigating", "identified", "resolved"], default "investigating"
const INCIDENT_STATUS_VALUES = ["investigating", "identified", "resolved"];
const incidentStatusArray = [...INCIDENT_STATUS_VALUES];
incidentStatusArray.INVESTIGATING = "investigating";
incidentStatusArray.IDENTIFIED = "identified";
incidentStatusArray.RESOLVED = "resolved";
const INCIDENT_STATUS = Object.freeze(incidentStatusArray);

// ASSUMPTION(M9->team): PROPOSED forward-only transition map (keep in ONE constant)
const INCIDENT_STATUS_TRANSITIONS = Object.freeze({
  investigating: Object.freeze(["identified", "resolved"]),
  identified: Object.freeze(["resolved"]),
  resolved: Object.freeze([])
});

const incidentSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      minlength: 3,
      maxlength: 200
    },
    severity: {
      type: String,
      enum: INCIDENT_SEVERITY,
      required: true
    },
    component: {
      type: String,
      enum: INCIDENT_COMPONENTS,
      required: true
    },
    status: {
      type: String,
      enum: INCIDENT_STATUS_VALUES,
      default: "investigating",
      required: true
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    resolvedAt: {
      type: Date
    }
  },
  {
    timestamps: true,
    strict: true
  }
);

incidentSchema.index({ status: 1, createdAt: -1 });
incidentSchema.index({ createdAt: -1 });

const Incident = mongoose.models.Incident || mongoose.model("Incident", incidentSchema);

module.exports = {
  Incident,
  INCIDENT_STATUS,
  INCIDENT_STATUS_TRANSITIONS,
  INCIDENT_SEVERITY,
  INCIDENT_COMPONENTS
};
