/**
 * Shared validation for extracted due dates.
 *
 * Both the chrono-based parser (`nl-parser.ts`) and the LLM-based parser
 * (`parse.ts`) can lift stray numbers out of body text — a court docket
 * ending in `-2005`, a "VibeSwipe PRD 2023" line — or hallucinate a date
 * entirely. That produced impossible due dates in the vault (e.g.
 * `2005-03-09`, `2023-10-01`, both in the past). This bounds every
 * extracted date so those never get persisted.
 */

function refComponents(
  reference: Date | string
): { year: number; month: number; day: number } {
  if (typeof reference === "string") {
    const m = reference.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      return { year: Number(m[1]), month: Number(m[2]) - 1, day: Number(m[3]) };
    }
    reference = new Date(reference);
  }
  return {
    year: reference.getFullYear(),
    month: reference.getMonth(),
    day: reference.getDate(),
  };
}

/**
 * Validate and normalize an extracted due date.
 *
 * Returns a canonical `YYYY-MM-DD` string, or `null` when the date is:
 * - malformed / not a real calendar date (rejects `2026-02-31`),
 * - before the reference day (a due date cannot precede creation),
 * - implausibly far in the future (> `maxFutureYears`, likely hallucinated).
 *
 * @param raw            The candidate date (`YYYY-MM-DD` or a fuller ISO string).
 * @param reference      "Now" / the creation date. Accepts a Date or `YYYY-MM-DD`.
 * @param maxFutureYears How far ahead a due date may plausibly sit (default 5).
 */
export function validateDueDate(
  raw: string | null | undefined,
  reference: Date | string = new Date(),
  maxFutureYears = 5
): string | null {
  if (!raw || typeof raw !== "string") return null;

  // Accept a leading YYYY-MM-DD (ignore any time/offset portion).
  const match = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]); // 1-12 as written
  const day = Number(match[3]);

  // Reject values that don't round-trip to a real calendar date.
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  // Compare as plain calendar days (tz-independent).
  const ref = refComponents(reference);
  const refDay = Date.UTC(ref.year, ref.month, ref.day);
  const parsedDay = Date.UTC(year, month - 1, day);

  if (parsedDay < refDay) return null;

  const maxFutureDay = Date.UTC(ref.year + maxFutureYears, ref.month, ref.day);
  if (parsedDay > maxFutureDay) return null;

  return `${match[1]}-${match[2]}-${match[3]}`;
}
