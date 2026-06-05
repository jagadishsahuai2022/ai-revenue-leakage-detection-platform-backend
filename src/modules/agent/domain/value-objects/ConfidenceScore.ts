// ── ConfidenceScore value object ──────────────────────────────────────────────
// Wraps a 0-1 float and encodes the business thresholds.

export class ConfidenceScore {
  private constructor(private readonly value: number) {}

  static readonly MIN_SUFFICIENT  = 0.6;
  static readonly MIN_HIGH        = 0.7;

  /** Factory — throws if out of [0, 1] range */
  static of(raw: number): ConfidenceScore {
    if (raw < 0 || raw > 1) {
      throw new RangeError(`ConfidenceScore must be in [0, 1], got ${raw}`);
    }
    return new ConfidenceScore(raw);
  }

  /** >= 0.7 — strong signal, safe to surface to approver */
  isHighConfidence(): boolean {
    return this.value >= ConfidenceScore.MIN_HIGH;
  }

  /** >= 0.6 — meets the minimum bar for execution consideration */
  isSufficient(): boolean {
    return this.value >= ConfidenceScore.MIN_SUFFICIENT;
  }

  toNumber(): number {
    return this.value;
  }

  toString(): string {
    return `ConfidenceScore(${this.value.toFixed(3)})`;
  }
}
