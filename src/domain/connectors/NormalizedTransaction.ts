/**
 * A provider-agnostic representation of a single revenue transaction.
 * Pure domain type — no Prisma or framework imports.
 */
export interface NormalizedTransaction {
  /** Unique identifier from the source provider (e.g. Stripe charge ID) */
  externalId: string;

  /** ISO-4217 currency code, lowercase (e.g. "usd") */
  currency: string;

  /** Amount in the smallest currency unit (e.g. cents for USD) */
  amountCents: number;

  /** UTC timestamp when the transaction occurred */
  occurredAt: Date;

  /** Human-readable description from the provider */
  description?: string;

  /** Provider-specific metadata preserved as-is */
  metadata?: Record<string, unknown>;

  /** Customer / account identifier on the provider side */
  customerId?: string;

  /** Subscription identifier that generated this transaction, if applicable */
  subscriptionId?: string;

  /** Status at the provider level (e.g. "succeeded", "failed", "refunded") */
  status: string;
}
