import { FastifyReply, FastifyRequest } from 'fastify';
import { GitHubService } from './github.service';
import { successResponse } from '../../../shared/utils/response';

export class GitHubController {
  constructor(private readonly githubService: GitHubService) {}

  async status(request: FastifyRequest, reply: FastifyReply) {
    const status = await this.githubService.getStatus(request.companyId);
    return reply.send(successResponse(status));
  }

  async disconnect(request: FastifyRequest, reply: FastifyReply) {
    await this.githubService.disconnect(request.companyId);
    return reply.status(204).send();
  }

  async listRepos(request: FastifyRequest, reply: FastifyReply) {
    const repos = await this.githubService.listRepos(request.companyId);
    return reply.send(successResponse(repos));
  }
}
