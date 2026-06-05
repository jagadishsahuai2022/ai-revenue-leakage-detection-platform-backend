// ── RiskScoringEngine ─────────────────────────────────────────────────────────
// Combines anomaly severity and forecast trend into a 0–100 composite risk
// score. Weights are intentionally conservative so scores stay interpretable.

import type { AnomalyReport } from './AnomalyDetector';
import type { ForecastReport } from './ForecastEngine';

export interface RiskScoringInput {
  anomalyReport: AnomalyReport;
  forecastReport: ForecastReport;
  /** Fraction of revenue affected by detected anomalies (0–1) */
  leakageFraction?: number;
}

export interface RiskScoreResult {
  /** Composite score 0–100 */
  score: number;
  /** Human-readable band */
  level: 'low' | 'medium' | 'high' | 'critical';
  /** Breakdown of contributing factors */
  factors: {
    anomalyScore: number;
    trendScore: number;
    leakageScore: number;
  };
  /** Plain-text rationale (no LLM, templated) */
  rationale: string;
}

// Weight distribution: anomaly 50 | trend 30 | leakage 20
const WEIGHTS = { anomaly: 50, trend: 30, leakage: 20 } as const;

export class RiskScoringEngine {
  score(input: RiskScoringInput): RiskScoreResult {
    const anomalyScore = this._anomalyScore(input.anomalyReport);
    const trendScore = this._trendScore(input.forecastReport);
    const leakageScore = this._leakageScore(input.leakageFraction ?? 0);

    const raw =
      anomalyScore * (WEIGHTS.anomaly / 100) +
      trendScore * (WEIGHTS.trend / 100) +
      leakageScore * (WEIGHTS.leakage / 100);

    const score = Math.min(100, Math.round(raw));
    const level = this._band(score);
    const rationale = this._rationale(score, level, input);

    return { score, level, factors: { anomalyScore, trendScore, leakageScore }, rationale };
  }

  // ── Component scorers ────────────────────────────────────────────────────

  private _anomalyScore(report: AnomalyReport): number {
    if (report.totalPoints === 0 || report.anomalyCount === 0) return 0;

    // Impact-based scoring: each anomaly contributes by severity
    // high=50, medium=30, low=15 — ensures even a single HIGH anomaly
    // produces a meaningful score (POC/MVP calibration).
    const highCount = report.anomalies.filter((a) => a.severity === 'high').length;
    const medCount = report.anomalies.filter((a) => a.severity === 'medium').length;
    const lowCount = report.anomalies.filter((a) => a.severity === 'low').length;

    const impactScore = highCount * 50 + medCount * 30 + lowCount * 15;

    // Anomaly-ratio bonus: more anomalies relative to total data → worse
    const ratio = Math.min(report.anomalyCount / report.totalPoints, 1);
    const ratioBonus = Math.round(ratio * 20);

    return Math.min(100, impactScore + ratioBonus);
  }

  private _trendScore(report: ForecastReport): number {
    if (!report.reliable) {
      // Even unreliable declining trends are concerning
      return report.slope < 0 ? 40 : 20;
    }
    switch (report.trend) {
      case 'declining': {
        // Stronger downward slope = higher risk
        const slopeRisk = Math.min(Math.abs(report.slope) * 10, 100);
        return Math.round(50 + slopeRisk * 0.5);
      }
      case 'flat': return 30;
      case 'growing': return Math.max(0, 20 - report.rSquared * 20);
    }
  }

  private _leakageScore(fraction: number): number {
    // Square-root scaling so moderate leakage fractions (5-20%) produce
    // meaningful scores instead of trivially low ones.
    return Math.min(100, Math.round(Math.sqrt(fraction) * 100));
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private _band(score: number): RiskScoreResult['level'] {
    if (score >= 75) return 'critical';
    if (score >= 50) return 'high';
    if (score >= 25) return 'medium';
    return 'low';
  }

  private _rationale(
    score: number,
    level: RiskScoreResult['level'],
    { anomalyReport, forecastReport, leakageFraction }: RiskScoringInput,
  ): string {
    const parts: string[] = [];
    if (anomalyReport.anomalyCount > 0) {
      parts.push(
        `${anomalyReport.anomalyCount} anomal${anomalyReport.anomalyCount === 1 ? 'y' : 'ies'} detected in ${anomalyReport.totalPoints} data points`,
      );
    }
    if (forecastReport.reliable) {
      parts.push(`Revenue trend is ${forecastReport.trend} (R²=${forecastReport.rSquared})`);
    }
    if (leakageFraction && leakageFraction > 0) {
      parts.push(`~${Math.round(leakageFraction * 100)}% of revenue affected by leakage events`);
    }
    const summary = parts.length > 0 ? parts.join('; ') + '. ' : '';
    return `${summary}Composite risk score: ${score}/100 (${level.toUpperCase()}).`;
  }
}
