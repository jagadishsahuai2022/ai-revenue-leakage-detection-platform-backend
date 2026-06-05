// ── AnomalyDetector ───────────────────────────────────────────────────────────
// Pure statistical anomaly detection. No LLM, no DB — operates on in-memory
// time-series data only. Two algorithms:
//   1. Moving-average deviation  (local trend)
//   2. Z-score threshold         (global distribution)

export interface DataPoint {
  /** ISO timestamp or epoch ms — used only for labelling output */
  timestamp: Date;
  value: number;
  /** Optional identifier, e.g. external revenue ID */
  label?: string;
}

export interface AnomalyResult {
  point: DataPoint;
  /** Index in the source array */
  index: number;
  /** Deviation from moving average (may be undefined for first window points) */
  movingAvgDeviation?: number;
  /** Global z-score */
  zScore: number;
  /** True when flagged by moving-average algorithm */
  isMovingAvgAnomaly: boolean;
  /** True when flagged by z-score algorithm */
  isZScoreAnomaly: boolean;
  /** Combined flag */
  isAnomaly: boolean;
  /** Severity classification */
  severity: 'none' | 'low' | 'medium' | 'high';
}

export interface AnomalyReport {
  totalPoints: number;
  anomalyCount: number;
  anomalies: AnomalyResult[];
  /** Descriptive stats for the full series */
  stats: {
    mean: number;
    stdDev: number;
    min: number;
    max: number;
    movingAvgWindow: number;
  };
}

// ── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_WINDOW = 7;          // 7-period moving average
const DEFAULT_MA_THRESHOLD = 2.0;  // > 2× moving-avg std dev → anomaly
const DEFAULT_Z_THRESHOLD = 2.5;   // |z| > 2.5 → anomaly

// ── Helpers ─────────────────────────────────────────────────────────────────

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stdDev(values: number[], mu?: number): number {
  if (values.length < 2) return 0;
  const m = mu ?? mean(values);
  const variance = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

// ── AnomalyDetector class ────────────────────────────────────────────────────

export class AnomalyDetector {
  private readonly windowSize: number;
  private readonly maThreshold: number;
  private readonly zThreshold: number;

  constructor(opts?: {
    windowSize?: number;
    movingAvgThreshold?: number;
    zScoreThreshold?: number;
  }) {
    this.windowSize = opts?.windowSize ?? DEFAULT_WINDOW;
    this.maThreshold = opts?.movingAvgThreshold ?? DEFAULT_MA_THRESHOLD;
    this.zThreshold = opts?.zScoreThreshold ?? DEFAULT_Z_THRESHOLD;
  }

  /**
   * Analyse a time-series and return a full anomaly report.
   * The series must be sorted ascending by timestamp before calling.
   */
  analyse(series: DataPoint[]): AnomalyReport {
    if (series.length === 0) {
      return {
        totalPoints: 0,
        anomalyCount: 0,
        anomalies: [],
        stats: { mean: 0, stdDev: 0, min: 0, max: 0, movingAvgWindow: this.windowSize },
      };
    }

    const values = series.map((p) => p.value);
    const globalMean = mean(values);
    const globalStd = stdDev(values, globalMean);
    const globalMin = Math.min(...values);
    const globalMax = Math.max(...values);

    // Pre-compute moving averages + std devs
    const maResults = this._movingAverageAnalysis(values);

    const results: AnomalyResult[] = series.map((point, i) => {
      const zScore = globalStd === 0 ? 0 : (point.value - globalMean) / globalStd;
      const isZScoreAnomaly = Math.abs(zScore) > this.zThreshold;

      const ma = maResults[i];
      const isMovingAvgAnomaly = ma.deviation !== undefined && Math.abs(ma.deviation) > this.maThreshold;

      const isAnomaly = isZScoreAnomaly || isMovingAvgAnomaly;

      const absZ = Math.abs(zScore);
      let severity: AnomalyResult['severity'] = 'none';
      if (isAnomaly) {
        if (absZ >= 4 || (ma.deviation !== undefined && Math.abs(ma.deviation) >= 4)) {
          severity = 'high';
        } else if (absZ >= 3 || (ma.deviation !== undefined && Math.abs(ma.deviation) >= 3)) {
          severity = 'medium';
        } else {
          severity = 'low';
        }
      }

      return {
        point,
        index: i,
        movingAvgDeviation: ma.deviation,
        zScore,
        isMovingAvgAnomaly,
        isZScoreAnomaly,
        isAnomaly,
        severity,
      };
    });

    const anomalies = results.filter((r) => r.isAnomaly);

    return {
      totalPoints: series.length,
      anomalyCount: anomalies.length,
      anomalies,
      stats: {
        mean: globalMean,
        stdDev: globalStd,
        min: globalMin,
        max: globalMax,
        movingAvgWindow: this.windowSize,
      },
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private _movingAverageAnalysis(values: number[]): Array<{ ma?: number; deviation?: number }> {
    return values.map((v, i) => {
      if (i < this.windowSize - 1) {
        // Not enough prior data for a full window
        return {};
      }
      const window = values.slice(i - this.windowSize + 1, i + 1);
      const ma = mean(window);
      const maStd = stdDev(window, ma);
      const deviation = maStd === 0 ? 0 : (v - ma) / maStd;
      return { ma, deviation };
    });
  }
}
