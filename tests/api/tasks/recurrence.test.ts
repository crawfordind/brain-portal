import { describe, it, expect } from 'vitest';
import { getNextOccurrence } from '@/lib/tasks/recurrence';

describe('Recurrence on completion', () => {
  it('spawns next occurrence for daily rule', () => {
    const after = new Date('2026-03-01T00:00:00Z');
    const next = getNextOccurrence('FREQ=DAILY', after);
    expect(next).not.toBeNull();
    expect(next!.toISOString().split('T')[0]).toBe('2026-03-02');
  });

  it('does not spawn when past end date', () => {
    const after = new Date('2026-04-01T00:00:00Z');
    const next = getNextOccurrence('FREQ=DAILY', after, '2026-03-31');
    expect(next).toBeNull();
  });

  it('does not spawn for task with no recurrence_rule', () => {
    const next = getNextOccurrence('', new Date());
    expect(next).toBeNull();
  });
});
