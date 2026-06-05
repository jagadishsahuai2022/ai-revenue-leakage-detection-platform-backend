import { PrismaClient } from "@prisma/client";
import axios from "axios";

import {
  RevenueProvider,
  NormalizedTransaction,
  NormalizedSubscription,
} from "../../../domain/connectors";
import { decryptCredential } from "../../../shared/utils/credential-encryption";
import { AppError } from "../../../shared/errors/AppError";

/**
 * Square adapter — implements `RevenueProvider`.
 *
 * Fetches payments from the Square Payments API v2 and normalises them
 * into `NormalizedTransaction` objects for the ConnectorEngine.
 *
 * Credentials (accessToken) are stored AES-256-encrypted in the
 * `ProviderConnection` table and decrypted at runtime.
 */
export class SquareAdapter implements RevenueProvider {
  readonly providerId = "SQUARE";

  private static readonly BASE_URL = "https://connect.squareup.com/v2";

  constructor(private readonly prisma: PrismaClient) {}

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async getAccessToken(companyId: string): Promise<string> {
    const conn = await this.prisma.providerConnection.findFirst({
      where: { companyId, provider: "SQUARE", status: "ACTIVE" },
      select: { accessToken: true },
    });

    if (!conn || !conn.accessToken) {
      throw AppError.badRequest("Square integration is not configured");
    }

    return decryptCredential(conn.accessToken);
  }

  // ── RevenueProvider implementation ────────────────────────────────────────

  async testConnection(companyId: string): Promise<boolean> {
    try {
      const token = await this.getAccessToken(companyId);
      const res = await axios.get(`${SquareAdapter.BASE_URL}/merchants/me`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        timeout: 10_000,
      });
      return res.status === 200;
    } catch {
      return false;
    }
  }

  async fetchTransactions(
    companyId: string,
    since?: Date,
  ): Promise<NormalizedTransaction[]> {
    const token = await this.getAccessToken(companyId);

    const body: Record<string, unknown> = {
      limit: 100,
      sort_order: "DESC",
    };

    if (since) {
      body.begin_time = since.toISOString();
    }

    const { data } = await axios.post(
      `${SquareAdapter.BASE_URL}/payments`,
      body,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        timeout: 8_000,
      },
    );

    const payments = data?.payments ?? [];

    return payments.map(
      (payment: Record<string, any>): NormalizedTransaction => {
        const amountMoney = payment.amount_money ?? {};
        return {
          externalId: `square_${payment.id}`,
          currency: (amountMoney.currency ?? "USD").toLowerCase(),
          amountCents: amountMoney.amount ?? 0,
          occurredAt: new Date(payment.created_at ?? Date.now()),
          description: payment.note ?? `Square Payment ${payment.id}`,
          customerId: payment.customer_id,
          status: (payment.status ?? "COMPLETED").toLowerCase(),
          metadata: {
            paymentId: payment.id,
            locationId: payment.location_id,
            sourceType: payment.source_type,
          },
        };
      },
    );
  }

  /**
   * Square does not have a native subscription model in Payments API.
   * Square Subscriptions API would be a separate integration.
   * Returns empty array for now.
   */
  async fetchSubscriptions(
    _companyId: string,
  ): Promise<NormalizedSubscription[]> {
    return [];
  }
}
