// ── AIInsightGenerator ────────────────────────────────────────────────────────
// Orchestrates all statistical engines and produces a structured insight bundle
// ready to persist to the DB or hand off to the LLM adapter.
// No external calls here — pure domain logic.

import { AnomalyDetector, DataPoint as AnomalyDataPoint, AnomalyReport } from './AnomalyDetector';
import { ForecastEngine, ForecastReport } from './ForecastEngine';
import { RiskScoringEngine, RiskScoreResult } from './RiskScoringEngine';

export interface TimeSeriesInput {
  timestamp: Date;
  /** Revenue amount for the period */
  amount: number;
  label?: string;
}

export interface StructuredInsight {
  /** ISO window covered by this analysis */
  windowStart: Date;
  windowEnd: Date;
  /** Number of data points analysed */
  dataPoints: number;
  anomalyReport: AnomalyReport;
  forecastReport: ForecastReport;
  riskScore: RiskScoreResult;
  /** Template-generated summary (no LLM). May be overwritten by LLM adapter. */
  summary: string;
  /** Top anomaly details for quick preview */
  topAnomalies: Array<{
    timestamp: Date;
    value: number;
    zScore: number;
    severity: string;
  }>;
}

export class AIInsightGenerator {
  private readonly anomalyDetector: AnomalyDetector;
  private readonly forecastEngine: ForecastEngine;
  private readonly riskScoringEngine: RiskScoringEngine;

  constructor(opts?: {
    anomalyWindowSize?: number;
    anomalyZThreshold?: number;
    forecastPeriodsAhead?: number;
  }) {
    this.anomalyDetector = new AnomalyDetector({
      windowSize: opts?.anomalyWindowSize ?? 7,
      zScoreThreshold: opts?.anomalyZThreshold ?? 2.5,
    });
    this.forecastEngine = new ForecastEngine();
    this.riskScoringEngine = new RiskScoringEngine();
  }

  /**
   * Generate a full structured insight from a time-series.
   * @param series - Must have at least 1 item. Sorted ascending by timestamp.
   * @param totalRevenue - Used to compute leakage fraction (optional).
   * @param leakageAmount - Detected leakage value in same currency as amounts.
   */
  generate(
    series: TimeSeriesInput[],
    totalRevenue?: number,
    leakageAmount?: number,
  ): StructuredInsight {
    if (series.length === 0) {
      throw new Error('Cannot generate insight from empty series');
    }

    // Sort ascending
    const sorted = [...series].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    const anomalyPoints: AnomalyDataPoint[] = sorted.map((p) => ({
      timestamp: p.timestamp,
      value: p.amount,
      label: p.label,
    }));

    const forecastPoints = sorted.map((p) => ({
      timestamp: p.timestamp,
      value: p.amount,
    }));

    const anomalyReport = this.anomalyDetector.analyse(anomalyPoints);
    const forecastReport = this.forecastEngine.forecast(forecastPoints, 3);

    const leakageFraction =
      totalRevenue && leakageAmount && totalRevenue > 0
        ? Math.min(leakageAmount / totalRevenue, 1)
        : 0;

    const riskScore = this.riskScoringEngine.score({
      anomalyReport,
      forecastReport,
      leakageFraction,
    });

    const windowStart = sorted[0].timestamp;
    const windowEnd = sorted[sorted.length - 1].timestamp;

    const topAnomalies = anomalyReport.anomalies
      .sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore))
      .slice(0, 5)
      .map((a) => ({
        timestamp: a.point.timestamp,
        value: a.point.value,
        zScore: Math.round(a.zScore * 100) / 100,
        severity: a.severity,
      }));

    const summary = this._buildSummary(anomalyReport, forecastReport, riskScore);

    return {
      windowStart,
      windowEnd,
      dataPoints: sorted.length,
      anomalyReport,
      forecastReport,
      riskScore,
      summary,
      topAnomalies,
    };
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private _buildSummary(
    anomaly: AnomalyReport,
    forecast: ForecastReport,
    risk: RiskScoreResult,
  ): string {
    const parts: string[] = [];

    if (anomaly.anomalyCount === 0) {
      parts.push('No statistical anomalies detected in the analysis window.');
    } else {
      const highCount = anomaly.anomalies.filter((a) => a.severity === 'high').length;
      const medCount = anomaly.anomalies.filter((a) => a.severity === 'medium').length;
      parts.push(
        `Detected ${anomaly.anomalyCount} revenue anomal${anomaly.anomalyCount === 1 ? 'y' : 'ies'}` +
          (highCount > 0 ? ` (${highCount} high severity)` : '') +
          (medCount > 0 ? ` (${medCount} medium severity)` : '') +
          '.',
      );
    }

    if (forecast.reliable) {
      if (forecast.trend === 'growing') {
        parts.push(`Revenue shows a ${forecast.trend} trend (R²=${forecast.rSquared}).`);
      } else if (forecast.trend === 'declining') {
        parts.push(
          `⚠️ Revenue trend is declining (slope=${forecast.slope}, R²=${forecast.rSquared}).`,
        );
      } else {
        parts.push('Revenue trend is flat.');
      }
    }

    parts.push(`Overall risk: ${risk.level.toUpperCase()} (${risk.score}/100).`);

    return parts.join(' ');
  }
}
