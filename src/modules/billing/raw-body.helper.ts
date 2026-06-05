import { FastifyInstance } from 'fastify';

/**
 * Fastify doesn't store rawBody by default.
 * This helper adds content-type parser that preserves rawBody for webhook verification.
 */
export function addContentTypeParser(fastify: FastifyInstance): void {
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (req, body: Buffer, done) => {
      (req as any).rawBody = body;
      // Empty body (e.g. POST /disconnect with no payload) — treat as empty object
      if (!body || body.length === 0) {
        done(null, {});
        return;
      }
      try {
        const json = JSON.parse(body.toString());
        done(null, json);
      } catch (err) {
        const error = err as Error;
        error.message = `Failed to parse JSON: ${error.message}`;
        done(error, undefined);
      }
    },
  );
}
