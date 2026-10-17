"use strict";

require("dotenv").config();

const dns = require("node:dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const app = require("./app");
const { connectDB, disconnectDB } = require("./config/db");

const PORT = Number(process.env.PORT) || 4000;

async function startServer() {
  if (!process.env.MONGODB_URI) {
    console.error("ContrixAI startup failed: MONGODB_URI is required. Copy .env.example to .env and configure it.");
    process.exit(1);
  }

  if (process.env.NODE_ENV === "production") {
    if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.includes("REPLACE")) {
      console.error("ContrixAI startup failed: Secure SESSION_SECRET is required in production.");
      process.exit(1);
    }
  }

    try {
    await connectDB();
  } catch (err) {
    console.error("ContrixAI startup failed: Database connection error.");
    console.error("Error name:", err.name);
    console.error("Error message:", err.message);
    process.exit(1);
  }

  const server = app.listen(PORT, () => {
    console.log(`ContrixAI API listening on port ${PORT}`);
  });

  let shuttingDown = false;

  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received; shutting down gracefully`);

    server.close(async (serverError) => {
      try {
        await disconnectDB();
      } catch (dbError) {
        console.error("Error while disconnecting MongoDB");
        process.exitCode = 1;
      }

      if (serverError) {
        console.error("Error while closing HTTP server");
        process.exitCode = 1;
      }
      process.exit();
    });
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("unhandledRejection", (reason) => {
    console.error("Unhandled promise rejection:", reason && reason.message ? reason.message : "Internal error");
    shutdown("unhandledRejection");
  });

  return server;
}

if (require.main === module) {
  startServer().catch(() => {
    console.error("ContrixAI startup failed. Check MONGODB_URI, database access, and network configuration.");
    process.exit(1);
  });
}

module.exports = { startServer };
