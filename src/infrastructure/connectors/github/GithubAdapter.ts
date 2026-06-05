import { PrismaClient } from '@prisma/client';
import axios from 'axios';

import {
  RevenueProvider,
  NormalizedTransaction,
  NormalizedSubscription,
} from '../../../domain/connectors';
import { AppError } from '../../../shared/errors/AppError';

/**
 * GitHub adapter — implements `RevenueProvider`.
 *
 * GitHub is a developer-tooling platform, not a payment processor, so:
 *  - `fetchTransactions` always returns an empty array
 *  - `fetchSubscriptions` always returns an empty array
 *
 * The value of this adapter lies in `testConnection` (validates the stored
 * OAuth token) and the ability to be registered in the `ProviderRegistry`
 * so that `ConnectorEngine` can treat all providers uniformly.
 *
 * If GitHub Sponsors data becomes relevant in the future, this is the
 * correct place to add that fetch logic.
 */
export class GithubAdapter implements RevenueProvider {
  readonly providerId = 'GITHUB';

  constructor(private readonly prisma: PrismaClient) {}

  // ── helpers ────────────────────────────────────────────────────────────────

  private async getAccessToken(companyId: string): Promise<string> {
    const integration = await this.prisma.integration.findFirstOrThrow({
      where: { companyId, provider: 'GITHUB', status: 'ACTIVE' },
      select: { accessToken: true },
    });

    if (!integration.accessToken) {
      throw AppError.badRequest('GitHub integration is not authorized');
    }

    return integration.accessToken;
  }

  // ── RevenueProvider implementation ────────────────────────────────────────

  async testConnection(companyId: string): Promise<boolean> {
    try {
      const token = await this.getAccessToken(companyId);

      await axios.get('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
        },
      });

      return true;
    } catch {
      return false;
    }
  }

  /**
   * GitHub has no revenue transactions — returns empty array.
   * Exists to satisfy the `RevenueProvider` contract.
   */
  async fetchTransactions(
    _companyId: string,
    _since?: Date,
  ): Promise<NormalizedTransaction[]> {
    return [];
  }

  /**
   * GitHub has no subscription model — returns empty array.
   * Exists to satisfy the `RevenueProvider` contract.
   */
  async fetchSubscriptions(_companyId: string): Promise<NormalizedSubscription[]> {
    return [];
  }
}
