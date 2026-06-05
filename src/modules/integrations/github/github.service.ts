import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import { AppError } from '../../../shared/errors/AppError';

interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  language: string | null;
  updated_at: string;
}

export class GitHubService {
  constructor(private readonly prisma: PrismaClient) {}

  private async getAccessToken(companyId: string): Promise<string> {
    const integration = await this.prisma.integration.findFirstOrThrow({
      where: { companyId, provider: 'GITHUB', status: 'ACTIVE' },
    });
    if (!integration.accessToken) throw AppError.badRequest('GitHub integration not authorized');
    return integration.accessToken;
  }

  async getStatus(companyId: string) {
    const integration = await this.prisma.integration.findFirst({
      where: { companyId, provider: 'GITHUB' },
      select: { id: true, status: true, externalId: true, lastSyncAt: true, errorMessage: true, config: true },
    });
    return { connected: !!integration && integration.status === 'ACTIVE', integration };
  }

  async disconnect(companyId: string) {
    await this.prisma.integration.updateMany({
      where: { companyId, provider: 'GITHUB' },
      data: { status: 'INACTIVE', accessToken: null, refreshToken: null },
    });
  }

  async listRepos(companyId: string) {
    const token = await this.getAccessToken(companyId);
    const res = await axios.get<GitHubRepo[]>('https://api.github.com/user/repos', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' },
      params: { per_page: 50, sort: 'updated' },
    });

    await this.prisma.integration.updateMany({
      where: { companyId, provider: 'GITHUB' },
      data: { lastSyncAt: new Date() },
    });

    return res.data.map((r) => ({
      id: r.id,
      name: r.name,
      fullName: r.full_name,
      private: r.private,
      url: r.html_url,
      description: r.description,
      stars: r.stargazers_count,
      forks: r.forks_count,
      openIssues: r.open_issues_count,
      language: r.language,
      updatedAt: r.updated_at,
    }));
  }

  // Called from auth service after GitHub OAuth – store token in integrations table
  async upsertIntegration(companyId: string, accessToken: string, githubUsername: string, githubId: string) {
    await this.prisma.integration.upsert({
      where: { companyId_provider: { companyId, provider: 'GITHUB' } },
      create: {
        companyId,
        provider: 'GITHUB',
        status: 'ACTIVE',
        accessToken,
        externalId: githubId,
        config: { username: githubUsername },
      },
      update: {
        status: 'ACTIVE',
        accessToken,
        externalId: githubId,
        config: { username: githubUsername },
        errorMessage: null,
      },
    });
  }
}
