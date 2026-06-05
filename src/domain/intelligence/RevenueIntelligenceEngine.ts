import { NormalizedTransaction } from '../connectors/NormalizedTransaction';
import { NormalizedSubscription } from '../connectors/NormalizedSubscription';

// ---------------------------------------------------------------------------
// Shared value objects
// ---------------------------------------------------------------------------

/**
 * Severity tier returned by the intelligence engine.
 * CRITICAL → immediate action required
 * HIGH      → review within 24 h
 * MEDIUM    → review within a week
 * LOW       → informational
 */
export type InsightSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

/**
 * Type discriminator for the category of insight produced.
 */
export type InsightType =
  | 'REVENUE_LEAKAGE'
  | 'CHURN_RISK'
  | 'DUPLICATE_CHARGE'
  | 'FAILED_PAYMENT'
  | 'ANOMALY'
  | 'SUBSCRIPTION_DOWNGRADE'
  | string;

// ---------------------------------------------------------------------------
// Core result type
// ---------------------------------------------------------------------------

/**
 * A single AI-generated insight produced from analysing revenue events.
 * Pure domain type — no Prisma or framework imports.
 */
export interface AIInsight {
  /** Category of the insight */
  type: InsightType;

  /** Severity classification */
  severity: InsightSeverity;

  /** Human-readable title (≤ 120 chars) */
  title: string;

  /** Detailed explanation of the issue and recommended action */
  description: string;

  /**
   * Estimated monetary impact in the smallest currency unit.
   * May be `undefined` when the impact cannot be quantified.
   */
  estimatedImpactCents?: number;

  /** ISO-4217 currency code for `estimatedImpactCents` */
  currency?: string;

  /**
   * External IDs of the transactions / subscriptions that contributed
   * to this insight.
   */
  affectedExternalIds?: string[];

  /** Structured evidence the model used to produce this insight */
  evidence?: Record<string, unknown>;

  /** UTC timestamp at which this insight was generated */
  generatedAt: Date;
}

// ---------------------------------------------------------------------------
// Log entries persisted to `RevenueEventLog`
// ---------------------------------------------------------------------------

/**
 * A lightweight log record capturing a revenue event as it flows through
 * the system. Corresponds to the `RevenueEventLog` Prisma model.
 * Pure domain type — no Prisma imports.
 */
export interface RevenueEventLogEntry {
  companyId: string;

  /**
   * Event type tag.
   * Mirrors `ConnectorEvent.eventType` but is also used for AI-derived events.
   */
  type: string;

  /** Arbitrary structured payload */
  payload: Record<string, unknown>;

  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Extension-point interface
// ---------------------------------------------------------------------------

/**
 *契約 (contract) for AI / ML engines that analyse revenue streams and
 * produce actionable insights.
 *
 * The concrete implementation is intentionally left out of this package.
 * Wire a real implementation (OpenAI, AWS Bedrock, heuristic rules, …) in
 * the application or infrastructure layer — never here.
 *
 * @example
 * // Minimal no-op implementation for testing:
 * class NoOpIntelligenceEngine implements RevenueIntelligenceEngine {
 *   async analyseTransactions() { return []; }
 *   async analyseSubscriptions() { return []; }
 *   async detectLeakage() { return []; }
 * }
 */
export interface RevenueIntelligenceEngine {
  /**
   * Analyse a batch of normalized transactions and return zero-or-more
   * insights.
   */
  analyseTransactions(
    companyId: string,
    transactions: NormalizedTransaction[],
  ): Promise<AIInsight[]>;

  /**
   * Analyse the active subscription portfolio for churn/downgrade risk.
   */
  analyseSubscriptions(
    companyId: string,
    subscriptions: NormalizedSubscription[],
  ): Promise<AIInsight[]>;

  /**
   * Cross-entity leakage detection: correlates transactions with
   * subscriptions to find mismatches, failed renewals, etc.
   */
  detectLeakage(
    companyId: string,
    transactions: NormalizedTransaction[],
    subscriptions: NormalizedSubscription[],
  ): Promise<AIInsight[]>;
}
