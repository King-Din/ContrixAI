"use strict";

const dns = require("node:dns");
const mongoose = require("mongoose");

// Ensure MongoDB SRV records resolve cleanly on Windows without ECONNREFUSED
try {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
} catch {
  // Ignore if custom DNS servers cannot be set
}

async function connectDB() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error("MONGODB_URI is missing from the environment");
  }

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 4000 });
    console.log("MongoDB connected successfully");
  } catch (err) {
    console.warn("Primary MongoDB connection failed. Falling back to local MongoDB...", err.message);
    const localUri = "mongodb://127.0.0.1:27017/contrixai_demo";
    await mongoose.connect(localUri, { serverSelectionTimeoutMS: 4000 });
    console.log("Connected to fallback local MongoDB at", localUri);
  }
}

async function disconnectDB() {
  await mongoose.disconnect();
}

module.exports = { connectDB, disconnectDB };
