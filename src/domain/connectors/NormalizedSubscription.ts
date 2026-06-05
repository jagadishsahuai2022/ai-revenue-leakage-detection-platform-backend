/**
 * A provider-agnostic representation of a subscription record.
 * Pure domain type — no Prisma or framework imports.
 */
export interface NormalizedSubscription {
  /** Unique identifier from the source provider */
  externalId: string;

  /** Customer / account identifier on the provider side */
  customerId: string;

  /** ISO-4217 currency code, lowercase */
  currency: string;

  /** Recurring amount in the smallest currency unit */
  amountCents: number;

  /** Billing interval, e.g. "month", "year", "week" */
  interval: string;

  /** Current subscription lifecycle status */
  status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'unpaid' | string;

  /** UTC timestamp when the subscription started */
  startedAt: Date;

  /** UTC timestamp when the current period ends, if known */
  currentPeriodEndsAt?: Date;

  /** UTC timestamp when the subscription was canceled, if applicable */
  canceledAt?: Date;

  /** Provider-specific metadata preserved as-is */
  metadata?: Record<string, unknown>;
}
