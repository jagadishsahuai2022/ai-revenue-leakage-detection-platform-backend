// ── RunIntelligenceAnalysisUseCase ────────────────────────────────────────────
// Application-layer use case that:
//   1. Fetches recent RevenueEventLog entries for the company (no raw DB dump)
//   2. Converts them to a time-series
//   3. Runs the statistical engine (AnomalyDetector + ForecastEngine + RiskScoringEngine)
//   4. Persists an AIInsight row
//
// The LLM adapter is intentionally NOT called here; it is always opt-in via
// a separate enrichInsight() step in the AI controller.

import { PrismaClient } from '@prisma/client';
import { AIInsightGenerator, StructuredInsight } from '../../domain/intelligence/AIInsightGenerator';

export interface RunAnalysisOptions {
  companyId: string;
  /** How many days to look back (default: 30) */
  lookbackDays?: number;
  /** Override the anomaly z-score threshold (default: 2.5) */
  zScoreThreshold?: number;
  /**
   * AI model ID used for optional LLM enrichment, stored on the insight row
   * so the UI can show which model generated the analysis.
   * e.g. "groq/llama-3.1-8b-instant"
   */
  modelId?: string;
}

export interface RunAnalysisResult {
  insightId: string;
  insight: StructuredInsight;
  /** Whether the company had enough data to produce a reliable result */
  sufficient: boolean;
}

export class RunIntelligenceAnalysisUseCase {
  private readonly generator: AIInsightGenerator;

  constructor(private readonly prisma: PrismaClient) {
    this.generator = new AIInsightGenerator();
  }

  async execute(opts: RunAnalysisOptions): Promise<RunAnalysisResult> {
    const { companyId, lookbackDays = 30, zScoreThreshold, modelId } = opts;

    const since = new Date();
    since.setDate(since.getDate() - lookbackDays);

    // ── 1. Fetch aggregated revenue data ─────────────────────────────────────
    // We query Revenue (the core financial table) grouped by day so we never
    // dump raw PII or large payloads to the LLM.
    const revenueRows = await this.prisma.revenue.findMany({
      where: {
        companyId,
        period: { gte: since },
      },
      select: {
        period: true,
        amount: true,
        id: true,
      },
      orderBy: { period: 'asc' },
    });

    // ── 2. Fetch leakage totals for the same window ───────────────────────────
    const leakageAgg = await this.prisma.revenueLeakage.aggregate({
      where: {
        companyId,
        detectedAt: { gte: since },
        isResolved: false,
      },
      _sum: { amount: true },
      _count: { id: true },
    });

    // ── 3. Build time-series (daily buckets) ─────────────────────────────────
    const buckets = new Map<string, number>();
    for (const row of revenueRows) {
      const key = row.period.toISOString().split('T')[0]; // YYYY-MM-DD
      buckets.set(key, (buckets.get(key) ?? 0) + Number(row.amount));
    }

    const series = Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dateStr, amount]) => ({
        timestamp: new Date(dateStr),
        amount,
      }));

    const totalRevenue = series.reduce((s, p) => s + p.amount, 0);
    const leakageAmount = Number(leakageAgg._sum.amount ?? 0);
    const sufficient = series.length >= 5;

    // ── 4. Generate structured insight ──────────────────────────────────────
    const generator = new AIInsightGenerator({
      anomalyZThreshold: zScoreThreshold,
    });

    // Guard: generate on real data or produce a minimal placeholder
    let insight: StructuredInsight;
    if (series.length === 0) {
      // No data yet — return a safe low-risk placeholder
      const now = new Date();
      insight = generator.generate(
        [{ timestamp: now, amount: 0 }],
        0,
        0,
      );
    } else {
      insight = generator.generate(series, totalRevenue, leakageAmount);
    }

    // ── 5. Deduplication guard ────────────────────────────────────────────────
    // If an insight for the exact same (companyId, windowStart, windowEnd)
    // already exists, return it instead of inserting an identical duplicate.
    // This prevents the dashboard from accumulating redundant cards every time
    // the user clicks "Run Analysis" without new data having arrived.
    if (series.length > 0) {
      const duplicate = await this.prisma.aIInsight.findFirst({
        where: {
          companyId,
          windowStart: insight.windowStart,
          windowEnd:   insight.windowEnd,
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      if (duplicate) {
        return { insightId: duplicate.id, insight, sufficient };
      }
    }

    // ── 6. Persist AIInsight (only when genuinely new data) ───────────────────
    const persisted = await this.prisma.aIInsight.create({
      data: {
        companyId,
        insightType: 'COMPOSITE',
        severity: insight.riskScore.level.toUpperCase(),
        title: this._buildTitle(insight),
        summary: insight.summary,
        data: {
          anomalyReport: this._serializeAnomalyReport(insight),
          forecastReport: insight.forecastReport as any,
          riskScore: insight.riskScore as any,
          topAnomalies: insight.topAnomalies as any,
          dataPoints: insight.dataPoints,
          leakageAmount,
          totalRevenue,
          lookbackDays,
        } as any,
        riskScore: insight.riskScore.score,
        windowStart: insight.windowStart,
        windowEnd: insight.windowEnd,
        llmEnriched: false,
        ...(modelId ? { modelId } : {}),
      },
    });

    return { insightId: persisted.id, insight, sufficient };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private _buildTitle(insight: StructuredInsight): string {
    const { level, score } = insight.riskScore;
    if (insight.anomalyReport.anomalyCount === 0) {
      return `Revenue analysis — no anomalies detected (risk: ${score}/100)`;
    }
    return (
      `${insight.anomalyReport.anomalyCount} anomal${insight.anomalyReport.anomalyCount === 1 ? 'y' : 'ies'} detected` +
      ` — ${level.toUpperCase()} risk (${score}/100)`
    );
  }

  /** Strip large arrays to keep the JSON payload DB-friendly */
  private _serializeAnomalyReport(insight: StructuredInsight) {
    const { anomalyReport } = insight;
    return {
      totalPoints: anomalyReport.totalPoints,
      anomalyCount: anomalyReport.anomalyCount,
      stats: anomalyReport.stats,
      // Keep only the top 20 anomalies to avoid megabyte JSON blobs
      anomalies: anomalyReport.anomalies.slice(0, 20).map((a) => ({
        timestamp: a.point.timestamp,
        value: a.point.value,
        zScore: a.zScore,
        severity: a.severity,
        isMovingAvgAnomaly: a.isMovingAvgAnomaly,
        isZScoreAnomaly: a.isZScoreAnomaly,
      })),
    };
  }
}
