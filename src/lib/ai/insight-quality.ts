/**
 * Insight quality wrapper.
 *
 * The insight engine re-derived the same idea from overlapping note sets with
 * no memory of what it already said (e.g. 4-6 near-identical "biochar" insights,
 * two identical "Emergent Branding" insights from the same two notes). It also
 * never learned the user's taste — only 7 of 114 insights were ever actioned,
 * and there was no thumbs-up/down signal.
 *
 * This module is the pure, deterministic core of a quality pipeline that runs
 * before insights are persisted:
 *   1. semantic dedup      — drop candidates too similar to existing insights
 *   2. diversity budget    — cap insights per theme so one hot topic can't crowd
 *                            out the rest of the portfolio
 *   3. feedback-aware rank  — bias ranking by the user's up/down history
 *
 * All functions here are side-effect free so they can be unit-tested without a
 * database or the LLM. The DB/embedding wiring lives in the generate route.
 */

import { cosineSimilarity } from "./vector";

export const DEFAULT_DEDUP_THRESHOLD = 0.88;
export const DEFAULT_MAX_PER_TYPE = 3;

// ─── Semantic dedup ──────────────────────────────────

export interface ExistingInsightVector {
  id: string;
  embedding: number[];
}

export type SuppressionReason =
  | "duplicate_of_existing"
  | "duplicate_of_candidate";

export interface DedupResult<T> {
  kept: T[];
  suppressed: {
    insight: T;
    reason: SuppressionReason;
    similarity: number;
    matchedId?: string;
  }[];
}

/**
 * Suppress candidate insights that are semantically near-duplicates of an
 * existing insight or of an earlier-kept candidate in the same batch.
 *
 * Candidates without an embedding are always kept (we can't judge similarity).
 * Comparison is order-stable: candidates are processed in the given order, so
 * the first occurrence of a cluster survives and later ones are dropped.
 *
 * @param candidates New insights, each optionally carrying an `embedding`.
 * @param existing   Vectors of already-persisted insights to dedup against.
 * @param threshold  Cosine similarity at/above which two insights are "the same".
 */
export function dedupeInsights<T extends { embedding?: number[] }>(
  candidates: T[],
  existing: ExistingInsightVector[],
  threshold: number = DEFAULT_DEDUP_THRESHOLD
): DedupResult<T> {
  const kept: T[] = [];
  const suppressed: DedupResult<T>["suppressed"] = [];
  const keptVectors: number[][] = [];

  for (const candidate of candidates) {
    const emb = candidate.embedding;
    if (!emb || emb.length === 0) {
      kept.push(candidate);
      continue;
    }

    // Compare against already-persisted insights first.
    let best = { similarity: -1, id: undefined as string | undefined };
    for (const e of existing) {
      if (e.embedding.length !== emb.length) continue;
      const sim = cosineSimilarity(emb, e.embedding);
      if (sim > best.similarity) best = { similarity: sim, id: e.id };
    }
    if (best.similarity >= threshold) {
      suppressed.push({
        insight: candidate,
        reason: "duplicate_of_existing",
        similarity: best.similarity,
        matchedId: best.id,
      });
      continue;
    }

    // Compare against candidates already kept in this batch.
    let batchBest = -1;
    for (const v of keptVectors) {
      const sim = cosineSimilarity(emb, v);
      if (sim > batchBest) batchBest = sim;
    }
    if (batchBest >= threshold) {
      suppressed.push({
        insight: candidate,
        reason: "duplicate_of_candidate",
        similarity: batchBest,
      });
      continue;
    }

    kept.push(candidate);
    keptVectors.push(emb);
  }

  return { kept, suppressed };
}

// ─── Diversity budget ────────────────────────────────

export interface DiversityResult<T> {
  kept: T[];
  suppressed: T[];
}

/**
 * Cap the number of insights per type so a single hot theme can't dominate a
 * generation batch. Within each type the highest-confidence insights are kept;
 * the returned `kept` list preserves the original input ordering for stability.
 *
 * @param insights   Insights with a `type` and `confidence`.
 * @param maxPerType Max insights to keep per type.
 */
export function applyDiversityBudget<
  T extends { type: string; confidence: number }
>(insights: T[], maxPerType: number = DEFAULT_MAX_PER_TYPE): DiversityResult<T> {
  if (maxPerType <= 0) return { kept: [], suppressed: [...insights] };

  // Rank within each type by confidence (desc), using original index as a
  // stable tiebreaker, and mark which survive the per-type cap.
  const byType = new Map<string, { item: T; index: number }[]>();
  insights.forEach((item, index) => {
    const group = byType.get(item.type) ?? [];
    group.push({ item, index });
    byType.set(item.type, group);
  });

  const survivorIndexes = new Set<number>();
  for (const group of byType.values()) {
    group
      .slice()
      .sort((a, b) => b.item.confidence - a.item.confidence || a.index - b.index)
      .slice(0, maxPerType)
      .forEach((entry) => survivorIndexes.add(entry.index));
  }

  const kept: T[] = [];
  const suppressed: T[] = [];
  insights.forEach((item, index) => {
    if (survivorIndexes.has(index)) kept.push(item);
    else suppressed.push(item);
  });

  return { kept, suppressed };
}

// ─── Feedback-aware ranking ──────────────────────────

export type FeedbackVote = "up" | "down";

/**
 * Derive a per-type ranking bias from the user's historical up/down votes.
 * Types the user consistently upvotes float up; downvoted types sink. The bias
 * is bounded to ±`cap` so feedback tilts ranking without overwhelming the
 * intrinsic confidence signal.
 */
export function computeTypeFeedbackBias(
  feedback: { type: string; feedback: FeedbackVote }[],
  cap: number = 0.3
): Record<string, number> {
  const net = new Map<string, number>();
  for (const f of feedback) {
    const delta = f.feedback === "up" ? 1 : -1;
    net.set(f.type, (net.get(f.type) ?? 0) + delta);
  }

  const bias: Record<string, number> = {};
  for (const [type, value] of net) {
    // tanh gives diminishing returns: a few votes move the needle, a flood
    // doesn't run away. Scaled so ~3 net votes reaches most of the cap.
    bias[type] = Math.max(-cap, Math.min(cap, cap * Math.tanh(value / 3)));
  }
  return bias;
}

/**
 * Order insights by an effective score: intrinsic confidence plus the per-type
 * feedback bias. Stable for equal scores (original order preserved).
 */
export function rankInsights<T extends { type: string; confidence: number }>(
  insights: T[],
  typeBias: Record<string, number> = {}
): T[] {
  return insights
    .map((item, index) => ({
      item,
      index,
      score: item.confidence + (typeBias[item.type] ?? 0),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.item);
}
