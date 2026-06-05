// ─────────────────────────────────────────────────────────────────────────────
// Unit Tests: AI Policy Engine
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { AIPolicyEngine, PolicyContext } from '../../src/modules/agent/domain/policies/AIPolicyEngine';

function ctx(overrides: Partial<PolicyContext> = {}): PolicyContext {
  return {
    actionType: 'FLAG_HIGH_RISK_ACCOUNT',
    estimatedImpact: 1000,
    confidenceScore: 0.8,
    companyId: 'company-1',
    companyPlan: 'GROWTH',
    featureFlags: {},
    ...overrides,
  };
}

describe('AIPolicyEngine', () => {
  const engine = new AIPolicyEngine();

  describe('DENY verdicts', () => {
    it('denies when AI_AGENT feature flag is disabled', () => {
      const result = engine.evaluate(ctx({ featureFlags: { AI_AGENT: false } }));
      expect(result.verdict).toBe('DENY');
      expect(result.reasons).toContain('FEATURE_GATE_AI_AGENT: DENY');
    });

    it('denies when confidence is < 0.3', () => {
      const result = engine.evaluate(ctx({ confidenceScore: 0.2 }));
      expect(result.verdict).toBe('DENY');
      expect(result.reasons).toContain('LOW_CONFIDENCE_BLOCK: DENY');
    });

    it('denies when estimated impact is 0', () => {
      const result = engine.evaluate(ctx({ estimatedImpact: 0 }));
      expect(result.verdict).toBe('DENY');
      expect(result.reasons).toContain('ZERO_IMPACT_BLOCK: DENY');
    });

    it('denies when estimated impact is negative', () => {
      const result = engine.evaluate(ctx({ estimatedImpact: -100 }));
      expect(result.verdict).toBe('DENY');
    });
  });

  describe('REQUIRE_APPROVAL verdicts', () => {
    it('requires double-approval for DISABLE_SUBSCRIPTION', () => {
      const result = engine.evaluate(ctx({ actionType: 'DISABLE_SUBSCRIPTION' }));
      expect(result.verdict).toBe('REQUIRE_APPROVAL');
      expect(result.requireDoubleApproval).toBe(true);
    });

    it('requires double-approval for NOTIFY_FINANCE_TEAM', () => {
      const result = engine.evaluate(ctx({ actionType: 'NOTIFY_FINANCE_TEAM' }));
      expect(result.verdict).toBe('REQUIRE_APPROVAL');
      expect(result.requireDoubleApproval).toBe(true);
    });

    it('requires double-approval for high-value RETRY_PAYMENT (>$5000)', () => {
      const result = engine.evaluate(ctx({
        actionType: 'RETRY_PAYMENT',
        estimatedImpact: 10000,
      }));
      expect(result.verdict).toBe('REQUIRE_APPROVAL');
      expect(result.requireDoubleApproval).toBe(true);
    });

    it('requires single approval for low-value RETRY_PAYMENT', () => {
      const result = engine.evaluate(ctx({
        actionType: 'RETRY_PAYMENT',
        estimatedImpact: 500,
      }));
      expect(result.verdict).toBe('REQUIRE_APPROVAL');
      expect(result.requireDoubleApproval).toBe(false);
    });

    it('requires approval for low confidence (0.3 <= c < 0.6)', () => {
      const result = engine.evaluate(ctx({ confidenceScore: 0.5 }));
      expect(result.verdict).toBe('REQUIRE_APPROVAL');
    });

    it('requires approval for STARTER plan regardless of action', () => {
      const result = engine.evaluate(ctx({ companyPlan: 'STARTER' }));
      expect(result.verdict).toBe('REQUIRE_APPROVAL');
    });
  });

  describe('ALLOW verdicts', () => {
    it('allows non-financial, high-confidence actions on GROWTH plan', () => {
      const result = engine.evaluate(ctx({
        actionType: 'FLAG_HIGH_RISK_ACCOUNT',
        confidenceScore: 0.9,
        estimatedImpact: 500,
        companyPlan: 'GROWTH',
      }));
      expect(result.verdict).toBe('ALLOW');
    });

    it('allows non-financial, high-confidence actions on ENTERPRISE plan', () => {
      const result = engine.evaluate(ctx({
        actionType: 'FLAG_HIGH_RISK_ACCOUNT',
        confidenceScore: 0.95,
        companyPlan: 'ENTERPRISE',
      }));
      expect(result.verdict).toBe('ALLOW');
    });
  });

  describe('most restrictive wins', () => {
    it('DENY beats REQUIRE_APPROVAL when both match', () => {
      // Confidence < 0.3 → DENY, actionType financial → REQUIRE_APPROVAL
      const result = engine.evaluate(ctx({
        actionType: 'RETRY_PAYMENT',
        confidenceScore: 0.1,
      }));
      expect(result.verdict).toBe('DENY');
    });
  });

  describe('custom rules', () => {
    it('accepts additional custom rules', () => {
      const customEngine = new AIPolicyEngine([
        {
          name: 'CUSTOM_BLOCK_ALL',
          matches: () => true,
          verdict: 'DENY',
        },
      ]);
      const result = customEngine.evaluate(ctx());
      expect(result.verdict).toBe('DENY');
      expect(result.reasons.some(r => r.includes('CUSTOM_BLOCK_ALL'))).toBe(true);
    });
  });
});
