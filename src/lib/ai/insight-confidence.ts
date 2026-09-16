/**
 * Insight confidence scoring.
 *
 * Historically every generated insight was persisted with a hardcoded
 * `confidence: 0.8` (the LLM was asked for a number but returned a flat 0.8
 * for 113 of 114 insights). A constant score is noise wearing a number's
 * clothes — users learn to ignore it, which poisons trust in every score the
 * app shows. This computes a real, deterministic confidence from the
 * structural signals we actually have at generation time.
 */

export type InsightType =
  | "connection"
  | "pattern"
  | "gap"
  | "leverage"
  | "question"
  | "theme"
  | "action"
  | "summary";

/**
 * Per-type adjustment. Evidence-grounded types (connection, pattern) lean on
 * the source-note count; interpretive and speculative types are discounted
 * because they assert more than the cited notes strictly support.
 */
const TYPE_ADJUSTMENT: Record<InsightType, number> = {
  connection: 0,
  pattern: 0,
  summary: -0.02,
  theme: -0.02,
  leverage: -0.03,
  action: -0.04, // prescriptive; easy to over-claim (the one shipped action insight was a false positive)
  gap: -0.05, // about what's *missing* — inherently less certain
  question: -0.05,
};

/**
 * Compute a confidence score in [0.05, 0.95] for a generated insight.
 *
 * The dominant signal is the number of independent supporting notes: a claim
 * corroborated by several notes is more trustworthy than one derived from a
 * single note (or none). The curve rises from ~0.30 (no cited evidence)
 * toward an asymptote of ~0.85, then a per-type adjustment is applied.
 *
 * @param sourceNoteCount Number of distinct notes cited as evidence.
 * @param type            The insight type.
 */
export function computeInsightConfidence(
  sourceNoteCount: number,
  type: InsightType | string
): number {
  const n = Math.max(0, Math.floor(sourceNoteCount) || 0);

  // Evidence curve: 0 → 0.30, 1 → 0.52, 2 → 0.65, 3 → 0.73, 4 → 0.78, 5 → 0.81,
  // asymptote 0.85. More independent corroboration → higher confidence.
  const evidence = 0.85 - 0.55 * Math.pow(0.6, n);

  const adjustment =
    (TYPE_ADJUSTMENT as Record<string, number>)[type] ?? -0.03;

  const raw = evidence + adjustment;
  const clamped = Math.max(0.05, Math.min(0.95, raw));

  // Two decimals — a score of "0.73" reads as computed; "0.8" read as a stub.
  return Math.round(clamped * 100) / 100;
}
