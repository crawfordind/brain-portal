import { RRule } from 'rrule';

/**
 * Compute the next occurrence date after `after`.
 * Returns null if no next occurrence exists (past end date or invalid rule).
 */
export function getNextOccurrence(
  recurrenceRule: string,
  after: Date,
  recurrenceEndDate?: string | null
): Date | null {
  if (!recurrenceRule) return null;
  try {
    // Anchor DTSTART to midnight UTC of the `after` date so occurrences always
    // land at midnight UTC and .toISOString().split('T')[0] gives the right date.
    const dtstart = new Date(Date.UTC(after.getFullYear(), after.getMonth(), after.getDate()));
    const rule = new RRule({
      ...RRule.parseString(recurrenceRule),
      dtstart,
    });
    const next = rule.after(after, false); // exclusive — don't include `after` itself

    if (!next) return null;

    if (recurrenceEndDate) {
      const endDate = new Date(recurrenceEndDate);
      if (next > endDate) return null;
    }

    return next;
  } catch {
    return null;
  }
}

/**
 * Convert an RRULE string to a human-readable description.
 * Returns null for empty / invalid input.
 */
export function rruleToText(recurrenceRule: string | null | undefined): string | null {
  if (!recurrenceRule) return null;
  try {
    const rule = RRule.fromString(`RRULE:${recurrenceRule}`);
    return rule.toText();
  } catch {
    return null;
  }
}
