// ── Client Logs Routes ────────────────────────────────────────────────────────
// POST /api/v1/client-logs
//
// Receives structured log entries from the frontend (errors, performance
// traces, breadcrumbs) and writes them to the server log under the
// company/request context.  Fire-and-forget — always returns 204.
//
// Body schema:
//   { logs: ClientLogEntry[] }
//   ClientLogEntry: { level, message, context?, timestamp? }

import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../../shared/middleware/auth.middleware";

const ClientLogEntrySchema = z
  .object({
    /** Log level — mirrors browser console levels */
    level: z.enum(["debug", "info", "warn", "error"]).default("info"),
    /** Event name / human-readable message.  Frontend sends `event`; accept both. */
    event: z.string().min(1).max(200).optional(),
    message: z.string().min(1).max(2000).optional(),
    /** Optional structured context / rich payload */
    payload: z.record(z.unknown()).optional(),
    context: z.record(z.unknown()).optional(),
    /** Client-side timestamp in ISO-8601 */
    timestamp: z.string().optional(),
    /** Additional observability fields sent by the frontend logger */
    userId: z.string().nullable().optional(),
    companyId: z.string().nullable().optional(),
    url: z.string().optional(),
    userAgent: z.string().optional(),
    sessionId: z.string().optional(),
  })
  .refine((d) => !!(d.message || d.event), {
    message: "Either message or event is required",
    path: ["message"],
  });

const ClientLogsBodySchema = z.object({
  logs: z.array(ClientLogEntrySchema).min(1).max(100),
});

export async function clientLogsRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  // POST /client-logs
  fastify.post("/", { preHandler: [authenticate] }, async (req, reply) => {
    const parsed = ClientLogsBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(422).send({
        success: false,
        error: "Invalid log entry format",
        code: "VALIDATION_ERROR",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const { logs } = parsed.data;

    // Write each entry into the server log under the request-scoped logger
    for (const entry of logs) {
      const msg = entry.message ?? entry.event ?? "client_log";
      const logPayload = {
        companyId: entry.companyId ?? req.companyId,
        userId: entry.userId ?? req.userId,
        clientTimestamp: entry.timestamp ?? null,
        context: entry.context ?? entry.payload ?? null,
        url: entry.url ?? null,
        sessionId: entry.sessionId ?? null,
      };

      switch (entry.level) {
        case "error":
          req.log.error(logPayload, `[CLIENT] ${msg}`);
          break;
        case "warn":
          req.log.warn(logPayload, `[CLIENT] ${msg}`);
          break;
        case "debug":
          req.log.debug(logPayload, `[CLIENT] ${msg}`);
          break;
        default:
          req.log.info(logPayload, `[CLIENT] ${msg}`);
      }
    }

    // 204 No Content — nothing to return
    return reply.code(204).send();
  });
}
