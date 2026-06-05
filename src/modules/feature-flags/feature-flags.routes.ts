// ── Feature Flags Routes ──────────────────────────────────────────────────────
// GET /api/v1/feature-flags
//
// Returns the effective feature flag map for the authenticated company.
// Per-company overrides stored in the FeatureFlag table are merged on top of
// platform-level defaults.  The frontend uses this to enable/disable UI tabs.

import { FastifyInstance } from 'fastify';
import { authenticate } from '../../shared/middleware/auth.middleware';
import { successResponse } from '../../shared/utils/response';

/** Platform-level defaults — applied when no per-company override exists. */
const PLATFORM_DEFAULTS: Record<string, boolean> = {
  AI_AGENT:            true,
  STRIPE_V2:           false,
  BULK_EXPORT:         false,
  ADVANCED_ANALYTICS:  false,
  DOUBLE_APPROVAL:     true,
  AI_SAFETY:           true,
};

export async function featureFlagsRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /feature-flags
  fastify.get(
    '/',
    { preHandler: [authenticate] },
    async (req, reply) => {
      // Fetch per-company overrides
      const rows = await fastify.prisma.featureFlag.findMany({
        where: { companyId: req.companyId },
        select: { feature: true, enabled: true },
      });

      // Merge: platform defaults first, then company overrides win
      const merged: Record<string, boolean> = { ...PLATFORM_DEFAULTS };
      for (const row of rows) {
        merged[row.feature] = row.enabled;
      }

      return reply.send(successResponse(merged));
    },
  );
}
