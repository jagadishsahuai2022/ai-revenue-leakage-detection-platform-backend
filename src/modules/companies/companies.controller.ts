import { FastifyReply, FastifyRequest } from 'fastify';
import { CompaniesService } from './companies.service';
import { UpdateCompanySchema } from './companies.schema';
import { successResponse, createdResponse } from '../../shared/utils/response';
import { z } from 'zod';

const CreateApiKeySchema = z.object({ name: z.string().min(1).max(100) });

export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  async get(request: FastifyRequest, reply: FastifyReply) {
    const company = await this.companiesService.findById(request.companyId);
    return reply.send(successResponse(company));
  }

  async update(request: FastifyRequest, reply: FastifyReply) {
    const input = UpdateCompanySchema.parse(request.body);
    const company = await this.companiesService.update(request.companyId, input);
    return reply.send(successResponse(company, 'Company updated'));
  }

  async stats(request: FastifyRequest, reply: FastifyReply) {
    const stats = await this.companiesService.getStats(request.companyId);
    return reply.send(successResponse(stats));
  }

  async createApiKey(request: FastifyRequest, reply: FastifyReply) {
    const { name } = CreateApiKeySchema.parse(request.body);
    const key = await this.companiesService.createApiKey(request.companyId, name);
    return reply.status(201).send(createdResponse(key, 'API key created — save the key now, it will not be shown again'));
  }

  async listApiKeys(request: FastifyRequest, reply: FastifyReply) {
    const keys = await this.companiesService.listApiKeys(request.companyId);
    return reply.send(successResponse(keys));
  }

  async revokeApiKey(
    request: FastifyRequest<{ Params: { keyId: string } }>,
    reply: FastifyReply,
  ) {
    await this.companiesService.revokeApiKey(request.companyId, request.params.keyId);
    return reply.status(204).send();
  }
}
