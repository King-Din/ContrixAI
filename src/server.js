const dns = require("node:dns");

dns.setServers(["8.8.8.8", "8.8.4.4"]);
require("dotenv").config();

const app = require("./app");
const { connectDB, disconnectDB } = require("./config/db");

const PORT = Number(process.env.PORT) || 4000;

async function startServer() {
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is required. Copy .env.example to .env and configure it.");
  }

  // M2/M4 own session/auth configuration. Validate the secret before starting
  // once their session middleware is integrated.
  await connectDB();

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
}

startServer().catch((err) => {
  // Do not print environment values or connection strings.
  console.error(`ContrixAI startup failed: ${err.message}`);
  process.exit(1);
});
