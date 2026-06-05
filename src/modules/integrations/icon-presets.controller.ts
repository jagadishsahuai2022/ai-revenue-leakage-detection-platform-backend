import { FastifyRequest, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { successResponse } from '../../shared/utils/response';

/**
 * GET /api/v1/integrations/icons/presets
 *
 * Public, no auth required.
 * Returns the full built-in icon preset catalog.
 * Data is sourced from the `provider_icons` DB table (seeded via migration).
 * Instructs CDN / browser to cache for 1 hour.
 */
export class IconPresetsController {
  constructor(private readonly prisma: PrismaClient) {}

  async listPresets(_request: FastifyRequest, reply: FastifyReply) {
    const icons = await this.prisma.providerIcon.findMany({
      orderBy: { sortOrder: 'asc' },
      select: {
        key: true,
        label: true,
        iconBg: true,
        iconSvgPath: true,
      },
    });

    return reply
      .header('Cache-Control', 'public, max-age=3600')
      .send(successResponse(icons));
  }
}
