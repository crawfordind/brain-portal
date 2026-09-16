import { describe, it, expect } from 'vitest';
import { validateDueDate } from '@/lib/tasks/date-utils';

describe('validateDueDate', () => {
  const ref = '2026-07-06';

  it('accepts a valid future date', () => {
    expect(validateDueDate('2026-08-01', ref)).toBe('2026-08-01');
  });

  it('accepts the reference day itself (due == created)', () => {
    expect(validateDueDate('2026-07-06', ref)).toBe('2026-07-06');
  });

  it('rejects dates before the reference (due < created)', () => {
    // The two impossible dates seen in the exported vault.
    expect(validateDueDate('2005-03-09', ref)).toBeNull();
    expect(validateDueDate('2023-10-01', ref)).toBeNull();
    expect(validateDueDate('2026-07-05', ref)).toBeNull();
  });

  it('rejects implausibly far-future dates (> 5 years)', () => {
    expect(validateDueDate('2032-01-01', ref)).toBeNull();
    // ...but allows within the window.
    expect(validateDueDate('2031-07-06', ref)).toBe('2031-07-06');
  });

  it('rejects malformed / non-calendar dates', () => {
    expect(validateDueDate('2026-02-31', ref)).toBeNull();
    expect(validateDueDate('not a date', ref)).toBeNull();
    expect(validateDueDate('2026/07/06', ref)).toBeNull();
  });

  it('rejects null/empty input', () => {
    expect(validateDueDate(null, ref)).toBeNull();
    expect(validateDueDate(undefined, ref)).toBeNull();
    expect(validateDueDate('', ref)).toBeNull();
  });

  it('normalizes a fuller ISO timestamp to the date portion', () => {
    expect(validateDueDate('2026-08-01T14:30:00Z', ref)).toBe('2026-08-01');
  });

  it('accepts a Date object as the reference', () => {
    const refDate = new Date(2026, 6, 6); // July 6, 2026 (local)
    expect(validateDueDate('2026-08-01', refDate)).toBe('2026-08-01');
    expect(validateDueDate('2020-01-01', refDate)).toBeNull();
  });
});
