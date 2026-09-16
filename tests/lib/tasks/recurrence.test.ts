import { describe, it, expect } from 'vitest';
import { getNextOccurrence, rruleToText } from '@/lib/tasks/recurrence';

describe('getNextOccurrence', () => {
  it('returns next daily occurrence after given date', () => {
    const after = new Date('2026-03-01T12:00:00Z');
    const result = getNextOccurrence('FREQ=DAILY', after);
    expect(result?.toISOString().split('T')[0]).toBe('2026-03-02');
  });

  it('returns next weekly occurrence on correct weekday', () => {
    const after = new Date('2026-03-01T00:00:00Z');
    const result = getNextOccurrence('FREQ=WEEKLY;BYDAY=MO', after);
    expect(result?.toISOString().split('T')[0]).toBe('2026-03-02');
  });

  it('returns null when past recurrence_end_date', () => {
    const after = new Date('2026-04-01T00:00:00Z');
    const result = getNextOccurrence('FREQ=DAILY', after, '2026-03-31');
    expect(result).toBeNull();
  });

  it('returns null for invalid RRULE string', () => {
    const result = getNextOccurrence('NOT_VALID', new Date());
    expect(result).toBeNull();
  });
});

describe('rruleToText', () => {
  it('converts daily rule to human text', () => {
    expect(rruleToText('FREQ=DAILY')).toBe('every day');
  });

  it('converts weekly rule to human text', () => {
    const text = rruleToText('FREQ=WEEKLY;BYDAY=MO,WE');
    expect(text).toMatch(/monday/i);
    expect(text).toMatch(/wednesday/i);
  });

  it('returns null for empty or invalid input', () => {
    expect(rruleToText('')).toBeNull();
    expect(rruleToText(null)).toBeNull();
  });
});
