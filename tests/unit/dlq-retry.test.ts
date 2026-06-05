// ─────────────────────────────────────────────────────────────────────────────
// Unit Tests: DLQ + Retry (executeWithRetry)
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi } from 'vitest';
import { executeWithRetry } from '../../src/shared/utils/dlq-retry';

describe('executeWithRetry', () => {
  it('returns on first success without retries', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await executeWithRetry(fn, { maxRetries: 3, baseDelayMs: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and succeeds on second attempt', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail-1'))
      .mockResolvedValue('ok');

    const result = await executeWithRetry(fn, { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 5 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausting all retries', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always-fail'));

    await expect(
      executeWithRetry(fn, { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 5 }),
    ).rejects.toThrow('always-fail');

    // 1 initial + 2 retries = 3 attempts
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('calls onExhausted callback when retries are exhausted', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('exhaust'));
    const onExhausted = vi.fn();

    await expect(
      executeWithRetry(fn, { maxRetries: 1, baseDelayMs: 1 }, onExhausted),
    ).rejects.toThrow('exhaust');

    expect(onExhausted).toHaveBeenCalledTimes(1);
    expect(onExhausted).toHaveBeenCalledWith(expect.any(Error), 2);
  });

  it('does not call onExhausted when retries succeed', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValue('recovered');
    const onExhausted = vi.fn();

    const result = await executeWithRetry(fn, { maxRetries: 2, baseDelayMs: 1 }, onExhausted);
    expect(result).toBe('recovered');
    expect(onExhausted).not.toHaveBeenCalled();
  });

  it('handles non-Error throws gracefully', async () => {
    const fn = vi.fn().mockRejectedValue('string-error');

    await expect(
      executeWithRetry(fn, { maxRetries: 0, baseDelayMs: 1 }),
    ).rejects.toThrow('string-error');
  });
});
