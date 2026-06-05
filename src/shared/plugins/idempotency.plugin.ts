// ─────────────────────────────────────────────────────────────────────────────
// API Idempotency Plugin
// Enforces at-most-once semantics for POST / PUT / PATCH mutations.
//
// Flow:
//  1. Client sends `X-Idempotency-Key: <uuid>` header
//  2. If key already exists in DB → return cached response (status + body)
//  3. Otherwise, let the handler run, then store the key + response for 24 h
//
// Keys are tenant-scoped (companyId) to prevent cross-tenant collisions.
// GET / DELETE / OPTIONS / HEAD are always passed through.
// ─────────────────────────────────────────────────────────────────────────────

import { FastifyInstance, FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

const IDEMPOTENT_METHODS = new Set(['POST', 'PUT', 'PATCH']);
const HEADER = 'x-idempotency-key';
const TTL_HOURS = 24;

const idempotencyPlugin: FastifyPluginCallback = (fastify: FastifyInstance, _opts, done) => {
  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!IDEMPOTENT_METHODS.has(request.method)) return;

    const idempotencyKey = request.headers[HEADER] as string | undefined;
    if (!idempotencyKey) return; // Key not supplied → normal processing

    const companyId = request.companyId || '__anonymous__';
    const compositeKey = `${companyId}:${idempotencyKey}`;

    try {
      const existing = await fastify.prisma.apiIdempotencyKey.findUnique({
        where: { key: compositeKey },
      });

      if (existing) {
        // Cache hit — replay the stored response
        request.log.info({ idempotencyKey }, 'Idempotency cache hit — replaying response');
        reply
          .status(existing.statusCode)
          .header('X-Idempotency-Replayed', 'true')
          .send(existing.responseBody);
        return; // Short-circuit; handler will NOT run
      }
    } catch (err) {
      // If the table doesn't exist yet (e.g. migration pending), log and continue
      request.log.warn({ err }, 'Idempotency lookup failed — proceeding without cache');
    }

    // Store metadata on request so the onSend hook can persist the response
    (request as unknown as Record<string, unknown>).__idempotencyCompositeKey = compositeKey;
    (request as unknown as Record<string, unknown>).__idempotencyRoute = `${request.method} ${request.url}`;
    (request as unknown as Record<string, unknown>).__idempotencyCompanyId = companyId;
  });

  fastify.addHook('onSend', async (request: FastifyRequest, reply: FastifyReply, payload: unknown) => {
    const compositeKey = (request as unknown as Record<string, unknown>).__idempotencyCompositeKey as string | undefined;
    if (!compositeKey) return payload; // No idempotency key → pass through

    const statusCode = reply.statusCode;
    const route = (request as unknown as Record<string, unknown>).__idempotencyRoute as string;
    const companyId = (request as unknown as Record<string, unknown>).__idempotencyCompanyId as string;

    // Only cache successful mutations (2xx)
    if (statusCode < 200 || statusCode >= 300) return payload;

    let responseBody: unknown;
    try {
      responseBody = typeof payload === 'string' ? JSON.parse(payload) : payload;
    } catch {
      responseBody = {};
    }

    const expiresAt = new Date(Date.now() + TTL_HOURS * 60 * 60 * 1000);

    try {
      await fastify.prisma.apiIdempotencyKey.create({
        data: {
          key: compositeKey,
          companyId,
          route,
          statusCode,
          responseBody: responseBody as object,
          expiresAt,
        },
      });
    } catch (err) {
      // Unique constraint race condition (another request beat us) → ignore
      request.log.warn({ err }, 'Failed to store idempotency key — might be a race');
    }

    return payload;
  });

  done();
};

export default fp(idempotencyPlugin, {
  name: 'api-idempotency',
  fastify: '4.x',
});
