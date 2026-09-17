import { describe, it, expect, vi, beforeEach } from 'vitest';
import { shouldTriggerAutoScan } from '@/lib/recommendations/auto-scan';

vi.mock('@/lib/db/client', async () => ({
  ...(await import('../../helpers/db-mock')).createDbClientMock(),
}));

/**
 * `n` actual words.
 *
 * These tests used to pass `'A'.repeat(300)` and call it "~60 words". It is one
 * 300-character word, so the word-delta check saw a *decrease* against the
 * stored count of 100 and never fired — the assertion was testing the fixture,
 * not the rule.
 */
function words(n: number): string {
  return Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
}

describe('shouldTriggerAutoScan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should trigger when conditions are met', async () => {
    const { queryOne } = await import('@/lib/db/client');

    const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();

    vi.mocked(queryOne).mockResolvedValue({
      id: 'daily1',
      metadata: JSON.stringify({
        last_user_activity_at: sixMinutesAgo,
        last_scan_at: fifteenMinutesAgo,
        last_scan_word_count: 100
      })
    });

    // 200 words against a stored 100 clears the 50-word delta threshold.
    const result = await shouldTriggerAutoScan('daily1', 'user1', words(200));

    expect(result.shouldScan).toBe(true);
  });

  it('should not trigger if user recently active', async () => {
    const { queryOne } = await import('@/lib/db/client');

    const nowISO = new Date().toISOString();

    vi.mocked(queryOne).mockResolvedValue({
      id: 'daily1',
      metadata: JSON.stringify({
        last_user_activity_at: nowISO,
        last_scan_word_count: 100
      })
    });

    const result = await shouldTriggerAutoScan('daily1', 'user1', words(200));

    expect(result.shouldScan).toBe(false);
    expect(result.reason).toContain('active');
  });
});
