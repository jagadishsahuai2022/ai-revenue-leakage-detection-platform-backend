import { buildApp } from "./app";
import { env } from "./config/env";
import { startWorkers, stopWorkers } from "./jobs/queues";

async function main() {
  const app = await buildApp();

  // ── Start BullMQ Workers ──────────────────────────────────────────────────
  if (env.REDIS_ENABLED) {
    startWorkers(app.prisma);
  }

  // ── Start HTTP Server ─────────────────────────────────────────────────────
  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    app.log.info(`🚀 Server running on http://${env.HOST}:${env.PORT}`);
    app.log.info(`📖 API prefix: ${env.API_PREFIX}`);
    if (env.NODE_ENV !== "production") {
      app.log.info(`📚 Swagger docs: http://${env.HOST}:${env.PORT}/docs`);
    }
  } catch (err) {
    app.log.fatal({ err }, "Server failed to start");
    process.exit(1);
  }
}

// ── Graceful Shutdown ─────────────────────────────────────────────────────────
async function gracefulShutdown(signal: string) {
  console.info(`\nReceived ${signal}, starting graceful shutdown...`);

  // Stop accepting new connections, drain existing
  const app = await buildApp();
  await app.close();
  if (env.REDIS_ENABLED) {
    await stopWorkers();
  }

  console.info("Graceful shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  // Fastify may surface ERR_HTTP_HEADERS_SENT when hooks try to modify headers
  // after a response has already been sent. These are non-fatal and can be
  // safely logged without terminating the process. Other rejection reasons
  // indicate actual bugs and should still crash the server so the orchestrator
  // can restart it.
  if (
    reason instanceof Error &&
    reason.name === "Error" &&
    reason.message.includes("ERR_HTTP_HEADERS_SENT")
  ) {
    console.warn(
      "Non-fatal unhandled rejection (headers already sent):",
      reason,
    );
    return;
  }
  console.error("Unhandled Rejection:", reason);
  process.exit(1);
});

main();
