// ── ForecastEngine ────────────────────────────────────────────────────────────
// Simple linear-regression forecasting on a time-series.
// No third-party ML libraries — pure math.

export interface DataPoint {
  timestamp: Date;
  value: number;
}

export interface ForecastPoint {
  /** How many periods ahead (1-indexed) */
  periodsAhead: number;
  /** Projected value */
  forecast: number;
  /** Lower bound of 95% prediction interval */
  lowerBound: number;
  /** Upper bound of 95% prediction interval */
  upperBound: number;
}

export interface ForecastReport {
  /** Slope of the regression line (positive = growth) */
  trend: 'growing' | 'declining' | 'flat';
  /** Raw slope value */
  slope: number;
  /** R² coefficient of determination (0–1) */
  rSquared: number;
  /** Forecasted points */
  forecasts: ForecastPoint[];
  /** Whether there was enough data to build a meaningful forecast */
  reliable: boolean;
}

const MIN_POINTS = 5; // fewer than this → unreliable

export class ForecastEngine {
  /**
   * Fit a linear trend to `series` and project `periodsAhead` into the future.
   * Series must be sorted ascending by timestamp.
   */
  forecast(series: DataPoint[], periodsAhead = 3): ForecastReport {
    if (series.length < MIN_POINTS) {
      return {
        trend: 'flat',
        slope: 0,
        rSquared: 0,
        forecasts: [],
        reliable: false,
      };
    }

    const n = series.length;
    // x = 0, 1, 2, … (index as time unit)
    const xs = series.map((_, i) => i);
    const ys = series.map((p) => p.value);

    const { slope, intercept, rSquared } = this._linearRegression(xs, ys);

    // Residual standard error (for prediction intervals)
    const residuals = ys.map((y, i) => y - (intercept + slope * i));
    const sse = residuals.reduce((s, r) => s + r ** 2, 0);
    const se = Math.sqrt(sse / Math.max(n - 2, 1));
    const tCritical = 1.96; // ~95% CI (large-sample approximation)

    const forecasts: ForecastPoint[] = [];
    for (let ahead = 1; ahead <= periodsAhead; ahead++) {
      const x = n - 1 + ahead;
      const forecast = intercept + slope * x;
      const margin = tCritical * se;
      forecasts.push({
        periodsAhead: ahead,
        forecast: Math.round(forecast * 100) / 100,
        lowerBound: Math.round((forecast - margin) * 100) / 100,
        upperBound: Math.round((forecast + margin) * 100) / 100,
      });
    }

    const SLOPE_THRESHOLD = 0.01 * (Math.max(...ys) - Math.min(...ys) || 1);
    const trend: ForecastReport['trend'] =
      slope > SLOPE_THRESHOLD ? 'growing' : slope < -SLOPE_THRESHOLD ? 'declining' : 'flat';

    return {
      trend,
      slope: Math.round(slope * 1000) / 1000,
      rSquared: Math.round(rSquared * 1000) / 1000,
      forecasts,
      reliable: rSquared > 0.5,
    };
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private _linearRegression(xs: number[], ys: number[]) {
    const n = xs.length;
    const sumX = xs.reduce((a, b) => a + b, 0);
    const sumY = ys.reduce((a, b) => a + b, 0);
    const sumXY = xs.reduce((s, x, i) => s + x * ys[i], 0);
    const sumX2 = xs.reduce((s, x) => s + x * x, 0);

    const denom = n * sumX2 - sumX ** 2;
    if (denom === 0) return { slope: 0, intercept: sumY / n, rSquared: 0 };

    const slope = (n * sumXY - sumX * sumY) / denom;
    const intercept = (sumY - slope * sumX) / n;

    // R²
    const yMean = sumY / n;
    const ssTot = ys.reduce((s, y) => s + (y - yMean) ** 2, 0);
    const ssRes = ys.reduce((s, y, i) => s + (y - (intercept + slope * i)) ** 2, 0);
    const rSquared = ssTot === 0 ? 1 : 1 - ssRes / ssTot;

    return { slope, intercept, rSquared };
  }
}
