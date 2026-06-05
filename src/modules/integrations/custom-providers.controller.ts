import { FastifyRequest, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import { AppError } from '../../shared/errors/AppError';
import { successResponse } from '../../shared/utils/response';
import {
  createCustomProviderSchema,
} from './custom-providers.schema';

/** Shape that maps to CustomProvider rows returned to the frontend */
function toResponse(cp: {
  id: string;
  name: string;
  description: string;
  iconBg: string;
  iconSvgPath: string;
  iconPresetKey: string;
  authType: string;
  baseUrl: string | null;
  fields: unknown;
  webhookSupport: boolean;
  status: string;
  createdAt: Date;
  createdById: string;
}) {
  return {
    id: cp.id,
    name: cp.name,
    description: cp.description,
    iconBg: cp.iconBg,
    iconSvgPath: cp.iconSvgPath,
    iconPresetKey: cp.iconPresetKey,
    authType: cp.authType,
    baseUrl: cp.baseUrl,
    fields: cp.fields,
    webhookSupport: cp.webhookSupport,
    status: cp.status,
    isCustom: true,
    supportsWebhook: cp.webhookSupport,
    supportsManualSync: true,
    connected: cp.status === 'CONNECTED',
    createdAt: cp.createdAt,
    createdById: cp.createdById,
  };
}

export class CustomProvidersController {
  constructor(private readonly prisma: PrismaClient) {}

  // POST /integrations/providers/custom
  async create(request: FastifyRequest, reply: FastifyReply) {
    const companyId = request.companyId;
    const userId = request.userId;

    const parsed = createCustomProviderSchema.safeParse(request.body);
    if (!parsed.success) {
      throw AppError.badRequest(
        parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '),
      );
    }

    const data = parsed.data;

    // Conflict check — unique per company + name
    const existing = await this.prisma.customProvider.findFirst({
      where: { companyId, name: { equals: data.name, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existing) {
      throw AppError.conflict(
        `A custom provider named "${data.name}" already exists for this company`,
      );
    }

    const provider = await this.prisma.customProvider.create({
      data: {
        companyId,
        createdById: userId,
        name: data.name,
        description: data.description,
        iconBg: data.iconBg,
        iconSvgPath: data.iconSvgPath,
        iconPresetKey: data.iconPresetKey,
        authType: data.authType,
        baseUrl: data.baseUrl ?? null,
        fields: data.fields as object[],
        webhookSupport: data.webhookSupport,
        status: 'DISCONNECTED',
      },
    });

    return reply.status(201).send(successResponse(toResponse(provider)));
  }

  // DELETE /integrations/providers/custom/:id
  async remove(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    const companyId = request.companyId;
    const userId = request.userId;
    const userRole = request.userRole;
    const { id } = request.params;

    const provider = await this.prisma.customProvider.findFirst({
      where: { id, companyId },
      select: { id: true, createdById: true, name: true },
    });

    if (!provider) throw AppError.notFound('Custom provider not found');

    // Only COMPANY_ADMIN or the creator may delete
    if (userRole !== 'COMPANY_ADMIN' && provider.createdById !== userId) {
      throw AppError.forbidden('You do not have permission to delete this provider');
    }

    await this.prisma.customProvider.delete({ where: { id } });

    return reply.status(204).send();
  }

  // POST /integrations/providers/custom/:id/ping
  async ping(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    const companyId = request.companyId;
    const { id } = request.params;

    const provider = await this.prisma.customProvider.findFirst({
      where: { id, companyId },
      select: { baseUrl: true },
    });
    if (!provider) throw AppError.notFound('Custom provider not found');
    if (!provider.baseUrl) {
      throw AppError.badRequest('This provider has no baseUrl configured');
    }

    const pingUrl = provider.baseUrl.replace(/\/$/, '') + '/health';
    const start = Date.now();

    try {
      const res = await axios.get(pingUrl, { timeout: 8000, validateStatus: () => true });
      const latencyMs = Date.now() - start;
      return reply.send(
        successResponse({ ok: res.status < 400, statusCode: res.status, latencyMs }),
      );
    } catch (err: unknown) {
      const latencyMs = Date.now() - start;
      const message =
        err instanceof Error ? err.message : 'Connection failed';
      return reply.send(
        successResponse({ ok: false, statusCode: null, latencyMs, error: message }),
      );
    }
  }
}
