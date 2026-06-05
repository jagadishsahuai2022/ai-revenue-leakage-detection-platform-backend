// ── Telemetry Controller ───────────────────────────────────────────────────────
// POST /api/v1/telemetry — lightweight product event ingestion.
// Events: INSIGHT_VIEWED, AI_RUN_TRIGGERED, AGENT_PROPOSAL_APPROVED,
//         CONNECTOR_ADDED, PAGE_VIEW, FEATURE_USED, etc.

import { FastifyReply, FastifyRequest } from "fastify";
import { PrismaClient, Prisma } from "@prisma/client";
import { z } from "zod";
import { successResponse, createdResponse } from "../../shared/utils/response";

const TelemetryEventSchema = z.object({
  eventType: z.string().min(1).max(80),
  metadata: z.record(z.unknown()).optional().default({}),
});

const TelemetryBatchSchema = z.object({
  events: z.array(TelemetryEventSchema).min(1).max(50),
});

export class TelemetryController {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * POST /telemetry — single event
   */
  async trackEvent(req: FastifyRequest, reply: FastifyReply) {
    const body = TelemetryEventSchema.parse(req.body ?? {});

    const event = await this.prisma.productEventLog.create({
      data: {
        companyId: req.companyId,
        userId: req.userId ?? null,
        eventType: body.eventType,
        metadata: body.metadata as Prisma.InputJsonValue,
      },
    });

    return reply.status(201).send(createdResponse({ id: event.id }));
  }

  /**
   * POST /telemetry/batch — up to 50 events in one request
   */
  async trackBatch(req: FastifyRequest, reply: FastifyReply) {
    const { events } = TelemetryBatchSchema.parse(req.body ?? {});

    const created = await this.prisma.productEventLog.createMany({
      data: events.map((e) => ({
        companyId: req.companyId,
        userId: req.userId ?? null,
        eventType: e.eventType,
        metadata: e.metadata as Prisma.InputJsonValue,
      })),
    });

    return reply.status(201).send(createdResponse({ count: created.count }));
  }

  /**
   * GET /telemetry/summary — event type counts for the company (last 30 days)
   */
  async getSummary(req: FastifyRequest, reply: FastifyReply) {
    const since = new Date();
    since.setDate(since.getDate() - 30);

    const rows = await this.prisma.productEventLog.groupBy({
      by: ["eventType"],
      where: { companyId: req.companyId, createdAt: { gte: since } },
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
    });

    const summary = rows.map((r) => ({
      eventType: r.eventType,
      count: r._count.id,
    }));

    return reply.send(
      successResponse({ since: since.toISOString(), events: summary }),
    );
  }
}
