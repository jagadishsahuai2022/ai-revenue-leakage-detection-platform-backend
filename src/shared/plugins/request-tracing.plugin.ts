// ─────────────────────────────────────────────────────────────────────────────
// Request Tracing Plugin
// Generates a UUID-v4 per incoming request and attaches it to:
//   • request.requestId  (decorates FastifyRequest)
//   • response header: X-Request-Id
//   • child logger: request.log.child({ requestId })
// Clients may also supply their own via the X-Request-Id header.
// ─────────────────────────────────────────────────────────────────────────────

import { FastifyInstance, FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';
import crypto from 'node:crypto';

const requestTracingPlugin: FastifyPluginCallback = (fastify: FastifyInstance, _opts, done) => {
  // Decorate request so TS knows about the property
  fastify.decorateRequest('requestId', '');

  fastify.addHook('onRequest', async (request, reply) => {
    // Allow client-supplied trace IDs (e.g. from an API gateway or load balancer)
    const clientId = request.headers['x-request-id'] as string | undefined;
    const requestId = clientId || crypto.randomUUID();

    // Attach to request
    request.requestId = requestId;

    // Add to reply headers so the caller can correlate
    reply.header('X-Request-Id', requestId);

    // Enrich logger context for all downstream logs
    request.log = request.log.child({ requestId });
  });

  done();
};

export default fp(requestTracingPlugin, {
  name: 'request-tracing',
  fastify: '4.x',
});
