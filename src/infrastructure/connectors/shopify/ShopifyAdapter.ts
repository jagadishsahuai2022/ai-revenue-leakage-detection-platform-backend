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
 * Shopify adapter — implements `RevenueProvider`.
 *
 * Fetches paid orders from the Shopify Admin REST API and normalises them
 * into `NormalizedTransaction` objects for the ConnectorEngine.
 *
 * Credentials (accessToken, shopDomain) are stored AES-256-encrypted in
 * the `ProviderConnection` table and decrypted at runtime.
 */
export class ShopifyAdapter implements RevenueProvider {
  readonly providerId = "SHOPIFY";

  constructor(private readonly prisma: PrismaClient) {}

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async getCredentials(companyId: string): Promise<{
    accessToken: string;
    shopDomain: string;
  }> {
    const conn = await this.prisma.providerConnection.findFirst({
      where: { companyId, provider: "SHOPIFY", status: "ACTIVE" },
      select: { accessToken: true, encryptedConfig: true },
    });

    if (!conn || !conn.accessToken) {
      throw AppError.badRequest("Shopify integration is not configured");
    }

    const accessToken = decryptCredential(conn.accessToken);
    const config = conn.encryptedConfig as Record<string, unknown>;
    const shopDomain = (config?.shopDomain as string) ?? "";

    if (!shopDomain) {
      throw AppError.badRequest("Shopify shop domain is not configured");
    }

    return { accessToken, shopDomain };
  }

  // ── RevenueProvider implementation ────────────────────────────────────────

  async testConnection(companyId: string): Promise<boolean> {
    try {
      const { accessToken, shopDomain } = await this.getCredentials(companyId);
      const res = await axios.get(
        `https://${shopDomain}/admin/api/2024-01/shop.json`,
        {
          headers: {
            "X-Shopify-Access-Token": accessToken,
            "Content-Type": "application/json",
          },
          timeout: 10_000,
        },
      );
      return res.status === 200;
    } catch {
      return false;
    }
  }

  async fetchTransactions(
    companyId: string,
    since?: Date,
  ): Promise<NormalizedTransaction[]> {
    const { accessToken, shopDomain } = await this.getCredentials(companyId);

    const params: Record<string, string> = {
      status: "any",
      financial_status: "paid",
      limit: "250",
    };

    if (since) {
      params.created_at_min = since.toISOString();
    }

    const queryString = new URLSearchParams(params).toString();
    const url = `https://${shopDomain}/admin/api/2024-01/orders.json?${queryString}`;

    const { data } = await axios.get(url, {
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
      },
      timeout: 8_000,
    });

    const orders = data?.orders ?? [];

    return orders.map(
      (order: Record<string, any>): NormalizedTransaction => ({
        externalId: `shopify_order_${order.id}`,
        currency: (order.currency ?? "USD").toLowerCase(),
        amountCents: Math.round(parseFloat(order.total_price ?? "0") * 100),
        occurredAt: new Date(order.created_at ?? Date.now()),
        description: `Shopify Order #${order.order_number ?? order.id}`,
        customerId: order.customer?.id?.toString(),
        status: order.financial_status ?? "paid",
        metadata: {
          orderId: order.id,
          orderNumber: order.order_number,
          shopDomain,
        },
      }),
    );
  }

  /**
   * Shopify subscriptions would require the Selling Plan APIs.
   * Returns empty array for now — extend when needed.
   */
  async fetchSubscriptions(
    _companyId: string,
  ): Promise<NormalizedSubscription[]> {
    return [];
  }
}
