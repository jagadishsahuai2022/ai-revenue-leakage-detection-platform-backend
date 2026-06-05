import { NormalizedTransaction } from './NormalizedTransaction';
import { NormalizedSubscription } from './NormalizedSubscription';
import { ConnectorEvent } from './ConnectorEvent';

/**
 * Core adapter contract every revenue-data provider must implement.
 *
 * Rules:
 * - Implementations live in `src/infrastructure/connectors/<provider>/`
 * - Implementations MAY import Prisma or external SDKs
 * - This interface MUST remain free of any infrastructure imports
 */
export interface RevenueProvider {
  /**
   * Human-readable identifier for the provider, matching the Prisma
   * `IntegrationProvider` enum value (e.g. "STRIPE", "GITHUB").
   */
  readonly providerId: string;

  /**
   * Fetch all or incremental transactions from the provider.
   *
   * @param companyId   Tenant scoping identifier
   * @param since       Optional lower-bound timestamp for incremental sync
   */
  fetchTransactions(
    companyId: string,
    since?: Date,
  ): Promise<NormalizedTransaction[]>;

  /**
   * Fetch active (and recently canceled) subscriptions from the provider.
   *
   * @param companyId   Tenant scoping identifier
   */
  fetchSubscriptions(companyId: string): Promise<NormalizedSubscription[]>;

  /**
   * Test connectivity and credential validity.
   * Returns `true` when the provider is reachable and credentials are valid.
   */
  testConnection(companyId: string): Promise<boolean>;

  /**
   * Handle a raw inbound webhook payload from the provider.
   * Returns the normalized domain events derived from the payload.
   *
   * Implementations should verify signatures before returning events.
   */
  handleWebhook?(
    companyId: string,
    rawBody: Buffer,
    headers: Record<string, string>,
  ): Promise<ConnectorEvent[]>;
}
