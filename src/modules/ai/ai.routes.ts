import { FastifyInstance } from 'fastify';
import { AIController } from './ai.controller';
import { authenticate } from '../../shared/middleware/auth.middleware';
import { requireRole } from '../../shared/middleware/rbac.middleware';
import { env } from '../../config/env';

export async function aiRoutes(fastify: FastifyInstance): Promise<void> {
  // ── Feature flag guard ─────────────────────────────────────────────────────
  // All AI routes are disabled unless ENABLE_AI_ENGINE=true.
  if (!env.ENABLE_AI_ENGINE) {
    fastify.all('/*', (_req, reply) => {
      reply.status(503).send({
        success: false,
        error: 'AI engine is disabled on this server',
        code: 'AI_DISABLED',
        message: 'Set ENABLE_AI_ENGINE=true in server environment to enable these routes.',
      });
    });
    return;
  }

  const ctrl = new AIController(fastify.prisma);

  const auth = { preHandler: [authenticate] };
  const adminAuth = { preHandler: [authenticate, requireRole('COMPANY_ADMIN')] };

  // POST /api/v1/ai/run
  fastify.post('/run', adminAuth, (req, rep) => ctrl.runAnalysis(req, rep));

  // GET /api/v1/ai/insights
  fastify.get('/insights', auth, (req, rep) => ctrl.listInsights(req, rep));

  // GET /api/v1/ai/insights/:insightId
  fastify.get('/insights/:insightId', auth, (req, rep) => ctrl.getInsight(req as any, rep));

  // PATCH /api/v1/ai/insights/:insightId/read
  fastify.patch('/insights/:insightId/read', auth, (req, rep) => ctrl.markRead(req as any, rep));

  // GET /api/v1/ai/usage
  fastify.get('/usage', adminAuth, (req, rep) => ctrl.listUsage(req, rep));

  // GET /api/v1/ai/models  — enabled model list + key-configured flag
  fastify.get('/models', auth, (req, rep) => ctrl.listModels(req, rep));
}
