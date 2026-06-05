/**
 * Represents a discrete event produced or consumed by a connector.
 * Pure domain type — no Prisma or framework imports.
 *
 * Note: The Prisma persistence model for this is named `ConnectorEventRecord`
 * to avoid naming conflicts with this pure domain type.
 */
export interface ConnectorEvent {
  /** Provider slug, e.g. "GITHUB", "STRIPE" */
  provider: string;

  /** Scoped tenant identifier */
  companyId: string;

  /**
   * Semantic event category:
   *  - "SYNC_STARTED"      – a full/incremental sync was triggered
   *  - "SYNC_COMPLETED"    – sync finished without unrecoverable errors
   *  - "SYNC_FAILED"       – sync terminated with an unrecoverable error
   *  - "TRANSACTION_RECEIVED" – a single normalized transaction ingested
   *  - "SUBSCRIPTION_RECEIVED" – a single normalized subscription ingested
   *  - "LEAKAGE_DETECTED"  – AI / rules engine flagged a potential leakage
   *  - "WEBHOOK_RECEIVED"  – a raw inbound webhook was accepted
   */
  eventType:
    | 'SYNC_STARTED'
    | 'SYNC_COMPLETED'
    | 'SYNC_FAILED'
    | 'TRANSACTION_RECEIVED'
    | 'SUBSCRIPTION_RECEIVED'
    | 'LEAKAGE_DETECTED'
    | 'WEBHOOK_RECEIVED'
    | string;

  /**
   * Optional external identifier (e.g. Stripe charge ID) used to deduplicate
   * events within a company+provider scope.
   */
  externalId?: string;

  /** Raw provider payload for audit / replay purposes */
  rawPayload?: Record<string, unknown>;

  /** Additional structured metadata relevant to the event */
  metadata?: Record<string, unknown>;

  /** UTC timestamp at which the event was created */
  occurredAt: Date;
}
