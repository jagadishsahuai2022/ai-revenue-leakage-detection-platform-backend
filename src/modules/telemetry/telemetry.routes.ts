import { FastifyInstance } from "fastify";
import { TelemetryController } from "./telemetry.controller";
import { authenticate } from "../../shared/middleware/auth.middleware";

export async function telemetryRoutes(fastify: FastifyInstance): Promise<void> {
  const ctrl = new TelemetryController(fastify.prisma);

  const auth = { preHandler: [authenticate] };

  // POST /api/v1/telemetry       — single event
  fastify.post("/", auth, (req, rep) => ctrl.trackEvent(req, rep));

  // POST /api/v1/telemetry/batch — up to 50 events
  fastify.post("/batch", auth, (req, rep) => ctrl.trackBatch(req, rep));

  // GET /api/v1/telemetry/summary — aggregated counts (last 30 days)
  fastify.get("/summary", auth, (req, rep) => ctrl.getSummary(req, rep));
}
