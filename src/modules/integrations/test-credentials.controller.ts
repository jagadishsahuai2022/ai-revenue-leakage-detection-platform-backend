import { FastifyRequest, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { AppError } from '../../shared/errors/AppError';
import { successResponse } from '../../shared/utils/response';
import { upsertTestCredentialSchema } from './test-credentials.schema';

type ProviderParams = { Params: { providerId: string } };

function normalizeId(raw: string): string {
  return raw.toLowerCase().trim();
}

/**
 * Endpoints under /api/v1/integrations/test-credentials
 *
 * GET  /test-credentials              — list all (COMPANY_ADMIN)
 * GET  /test-credentials/:providerId  — get one active record (any authed user)
 * PUT  /test-credentials/:providerId  — upsert (COMPANY_ADMIN)
 * DELETE /test-credentials/:providerId — delete (COMPANY_ADMIN)
 */
export class TestCredentialsController {
  constructor(private readonly prisma: PrismaClient) {}

  // ── GET /test-credentials ─────────────────────────────────────────────────
  /** List all test credentials (includes inactive). Admin only. */
  async listAll(_request: FastifyRequest, reply: FastifyReply) {
    const rows = await this.prisma.testCredential.findMany({
      orderBy: { providerId: 'asc' },
    });
    return reply.send(successResponse(rows));
  }

  // ── GET /test-credentials/:providerId ─────────────────────────────────────
  /**
   * Return active test credentials for a provider.
   * Returns `{ data: null }` (200) when no active record exists so the frontend
   * can silently skip pre-fill without handling a 404 error.
   */
  async getOne(request: FastifyRequest<ProviderParams>, reply: FastifyReply) {
    const providerId = normalizeId(request.params.providerId);

    const row = await this.prisma.testCredential.findFirst({
      where: { providerId, isActive: true },
      select: {
        providerId: true,
        label: true,
        credentials: true,
      },
    });

    // Return null payload (200) rather than 404 — the frontend silently skips
    // pre-fill when data is null, avoiding unnecessary error handling.
    return reply.send(successResponse(row ?? null));
  }

  // ── PUT /test-credentials/:providerId ─────────────────────────────────────
  /** Create or update test credentials for a provider. Admin only. */
  async upsert(request: FastifyRequest<ProviderParams>, reply: FastifyReply) {
    const providerId = normalizeId(request.params.providerId);
    const parsed = upsertTestCredentialSchema.safeParse(request.body);

    if (!parsed.success) {
      throw AppError.badRequest('Validation failed', parsed.error.errors.map((e) => e.message));
    }

    const { label, credentials, isActive } = parsed.data;

    const row = await this.prisma.testCredential.upsert({
      where: { providerId },
      create: {
        providerId,
        label: label ?? 'Test Credentials',
        credentials: credentials as object,
        isActive: isActive ?? true,
      },
      update: {
        ...(label !== undefined && { label }),
        credentials: credentials as object,
        ...(isActive !== undefined && { isActive }),
      },
    });

    return reply.send(successResponse(row));
  }

  // ── DELETE /test-credentials/:providerId ──────────────────────────────────
  /** Delete test credentials for a provider. Admin only. */
  async remove(request: FastifyRequest<ProviderParams>, reply: FastifyReply) {
    const providerId = normalizeId(request.params.providerId);

    const existing = await this.prisma.testCredential.findUnique({
      where: { providerId },
      select: { id: true },
    });

    if (!existing) {
      throw AppError.notFound(`No test credentials found for provider '${providerId}'`);
    }

    await this.prisma.testCredential.delete({ where: { providerId } });
    return reply.status(204).send();
  }
}
