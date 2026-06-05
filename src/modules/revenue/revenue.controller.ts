import { FastifyReply, FastifyRequest } from 'fastify';
import { RevenueService } from './revenue.service';
import {
  CreateRevenueSchema,
  UpdateRevenueSchema,
  RevenueQuerySchema,
  CreateLeakageSchema,
  LeakageQuerySchema,
} from './revenue.schema';
import { successResponse, createdResponse } from '../../shared/utils/response';
import { createAuditLog } from '../audit/audit.service';

export class RevenueController {
  constructor(private readonly revenueService: RevenueService) {}

  // Revenue
  async listRevenue(request: FastifyRequest<{ Querystring: Record<string, string> }>, reply: FastifyReply) {
    const query = RevenueQuerySchema.parse(request.query);
    const result = await this.revenueService.listRevenue(request.companyId, query);
    return reply.send(successResponse(result));
  }

  async getRevenue(request: FastifyRequest<{ Params: { revenueId: string } }>, reply: FastifyReply) {
    const revenue = await this.revenueService.getRevenue(request.companyId, request.params.revenueId);
    return reply.send(successResponse(revenue));
  }

  async createRevenue(request: FastifyRequest, reply: FastifyReply) {
    const input = CreateRevenueSchema.parse(request.body);
    const revenue = await this.revenueService.createRevenue(request.companyId, input);
    return reply.status(201).send(createdResponse(revenue));
  }

  async updateRevenue(request: FastifyRequest<{ Params: { revenueId: string } }>, reply: FastifyReply) {
    const input = UpdateRevenueSchema.parse(request.body);
    const revenue = await this.revenueService.updateRevenue(request.companyId, request.params.revenueId, input);
    return reply.send(successResponse(revenue, 'Revenue updated'));
  }

  async deleteRevenue(request: FastifyRequest<{ Params: { revenueId: string } }>, reply: FastifyReply) {
    await this.revenueService.deleteRevenue(request.companyId, request.params.revenueId);

    createAuditLog(request.server.prisma, {
      companyId: request.companyId,
      actorId: request.userId,
      actorEmail: request.userEmail,
      action: 'DELETE_REVENUE',
      resourceType: 'REVENUE_RECORD',
      resourceId: request.params.revenueId,
      detail: `Deleted revenue record ${request.params.revenueId}`,
      ipAddress: request.ip,
    }).catch(() => { /* silent */ });

    return reply.status(204).send();
  }

  async getAnalytics(request: FastifyRequest<{ Querystring: { from?: string; to?: string } }>, reply: FastifyReply) {
    const { from, to } = request.query;
    const analytics = await this.revenueService.getAnalytics(request.companyId, from, to);
    return reply.send(successResponse(analytics));
  }

  // Leakages
  async listLeakages(request: FastifyRequest<{ Querystring: Record<string, string> }>, reply: FastifyReply) {
    const query = LeakageQuerySchema.parse(request.query);
    const result = await this.revenueService.listLeakages(request.companyId, query);
    return reply.send(successResponse(result));
  }

  async createLeakage(request: FastifyRequest, reply: FastifyReply) {
    const input = CreateLeakageSchema.parse(request.body);
    const leakage = await this.revenueService.createLeakage(request.companyId, input);
    return reply.status(201).send(createdResponse(leakage));
  }

  async resolveLeakage(request: FastifyRequest<{ Params: { leakageId: string } }>, reply: FastifyReply) {
    const leakage = await this.revenueService.resolveLeakage(request.companyId, request.params.leakageId);

    // Fire-and-forget audit event
    createAuditLog(request.server.prisma, {
      companyId: request.companyId,
      actorId: request.userId,
      actorEmail: request.userEmail,
      action: 'RESOLVE_LEAKAGE',
      resourceType: 'REVENUE_LEAKAGE',
      resourceId: leakage.id,
      detail: `Resolved revenue leakage (category: ${leakage.category})`,
      ipAddress: request.ip,
    }).catch(() => { /* silent */ });

    return reply.send(successResponse(leakage, 'Leakage resolved'));
  }

  async deleteLeakage(request: FastifyRequest<{ Params: { leakageId: string } }>, reply: FastifyReply) {
    await this.revenueService.deleteLeakage(request.companyId, request.params.leakageId);
    return reply.status(204).send();
  }
}
