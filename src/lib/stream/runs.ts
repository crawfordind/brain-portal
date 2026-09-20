/**
 * Collapsing one job's output into one row.
 *
 * A single agent run that wrote two hundred rows used to arrive as two hundred
 * entries at the top of the feed, ordered by `updated_at` like everything
 * else, burying whatever the user actually needed to see. The rows were not
 * wrong and the user had asked for the work — they were just rendered as two
 * hundred unrelated thoughts instead of as the one thing they were.
 *
 * Given items carrying a `sourceRunId` (see `src/lib/provenance`), this folds
 * each run into a single entry so the feed shows:
 *
 *     Claude Desktop wrote 23 notes and 4 tasks · 2:14pm – 2:41pm
 *
 * Nothing is hidden. The entry expands to the rows it stands for, and one
 * archive clears the batch.
 *
 * Pure, so it can be tested against fixed input rather than a live feed. It
 * runs *before* `groupStream`, and its entries carry `updatedAt` so that
 * function can bucket them unchanged.
 */

import type { SourceActor } from "@/lib/provenance/types";

/** The minimum an item must carry to take part in collapsing. */
export interface RunnableItem {
  id: string;
  type: string;
  updatedAt: string;
  sourceActor: SourceActor;
  sourceLabel?: string | null;
  sourceRunId?: string | null;
}

export interface TypeCount {
  type: string;
  count: number;
}

export interface StreamRun<T> {
  runId: string;
  actor: SourceActor;
  /** The writer's name, as recorded when the rows were written. */
  label: string;
  /** The run's rows, newest first — the order they arrived in. */
  items: T[];
  typeCounts: TypeCount[];
  /** Oldest and newest `updatedAt` in the run. */
  startedAt: string;
  endedAt: string;
  /**
   * The run includes the oldest item currently loaded, so paging in more of
   * the feed may add to it. The counts are a lower bound until this is false;
   * the UI says "23+" rather than claiming a total it cannot know.
   */
  mayExtend: boolean;
}

export type StreamEntry<T> =
  | { kind: "item"; id: string; updatedAt: string; item: T }
  | { kind: "run"; id: string; updatedAt: string; run: StreamRun<T> };

/**
 * Below this, a run renders as its individual rows.
 *
 * Collapsing two rows into "Claude Desktop wrote 2 notes" costs the user a
 * click and tells them less than the two rows did. Summarising is only worth
 * it once the batch is big enough to be in the way.
 */
export const MIN_RUN_SIZE = 3;

export interface CollapseOptions {
  minRunSize?: number;
}

/**
 * Fold same-run items into one entry each, leaving everything else alone.
 *
 * Input is assumed newest-first, which is what `/api/stream` returns. A run's
 * entry takes the position of its **newest** member, so the feed's overall
 * ordering is exactly what it was — a run that started an hour ago and ended a
 * minute ago sits where its most recent write sits, not where it began.
 */
export function collapseRuns<T extends RunnableItem>(
  items: T[],
  options: CollapseOptions = {}
): StreamEntry<T>[] {
  const minRunSize = options.minRunSize ?? MIN_RUN_SIZE;

  // Pass 1: gather candidates. A human's writes are never collapsed even if
  // something stamped a run id on them — the user does not need their own
  // typing summarised back to them.
  const byRun = new Map<string, T[]>();
  for (const item of items) {
    if (!item.sourceRunId || item.sourceActor === "human") continue;
    const bucket = byRun.get(item.sourceRunId);
    if (bucket) bucket.push(item);
    else byRun.set(item.sourceRunId, [item]);
  }

  // Runs too small to be worth summarising fall back to individual rows.
  for (const [runId, members] of byRun) {
    if (members.length < minRunSize) byRun.delete(runId);
  }

  if (byRun.size === 0) {
    return items.map((item) => ({
      kind: "item",
      id: item.id,
      updatedAt: item.updatedAt,
      item,
    }));
  }

  const lastItemId = items.length > 0 ? items[items.length - 1].id : null;

  // Pass 2: walk the original order, emitting each run once at its newest
  // member and skipping the rest. Preserving the walk is what keeps the
  // result sorted without a second sort.
  const entries: StreamEntry<T>[] = [];
  const emitted = new Set<string>();

  for (const item of items) {
    const runId = item.sourceRunId;
    const members = runId ? byRun.get(runId) : undefined;

    if (!runId || !members) {
      entries.push({
        kind: "item",
        id: item.id,
        updatedAt: item.updatedAt,
        item,
      });
      continue;
    }

    if (emitted.has(runId)) continue;
    emitted.add(runId);

    entries.push({
      kind: "run",
      id: `run:${runId}`,
      updatedAt: item.updatedAt,
      run: buildRun(runId, members, lastItemId),
    });
  }

  return entries;
}

function buildRun<T extends RunnableItem>(
  runId: string,
  members: T[],
  lastItemId: string | null
): StreamRun<T> {
  const timestamps = members.map((m) => m.updatedAt).sort();

  return {
    runId,
    actor: members[0].sourceActor,
    // The label is denormalised onto every row, so any member answers; fall
    // back rather than render an empty name for a row written before labels.
    label: members.find((m) => m.sourceLabel)?.sourceLabel || "Automation",
    items: members,
    typeCounts: countTypes(members),
    startedAt: timestamps[0],
    endedAt: timestamps[timestamps.length - 1],
    mayExtend: lastItemId !== null && members.some((m) => m.id === lastItemId),
  };
}

/** Counts per item type, commonest first, ties broken alphabetically. */
export function countTypes(items: Array<{ type: string }>): TypeCount[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item.type, (counts.get(item.type) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

/**
 * Singular and plural nouns for what a run produced.
 *
 * The stream's internal type names are not what a person calls these things —
 * "reference" is a link, "agent_output" is a piece of AI work — so the summary
 * line does the translation rather than leaking the schema.
 */
const TYPE_NOUNS: Record<string, [string, string]> = {
  task: ["task", "tasks"],
  note: ["note", "notes"],
  thought: ["thought", "thoughts"],
  journal: ["journal entry", "journal entries"],
  question: ["question", "questions"],
  decision: ["decision", "decisions"],
  reference: ["link", "links"],
  insight: ["insight", "insights"],
  agent_output: ["piece of AI work", "pieces of AI work"],
  reminder: ["reminder", "reminders"],
  capture: ["capture", "captures"],
};

export function nounFor(type: string, count: number): string {
  const pair = TYPE_NOUNS[type];
  if (!pair) return count === 1 ? "item" : "items";
  return count === 1 ? pair[0] : pair[1];
}

/**
 * "23 notes and 4 tasks", or "23+ notes" when more may still be loading.
 *
 * Caps at two named types so the row stays one line at compact density; the
 * rest fold into a trailing count. The full breakdown is one expand away.
 */
export function formatRunSummary(
  typeCounts: TypeCount[],
  options: { mayExtend?: boolean; maxTypes?: number } = {}
): string {
  const maxTypes = options.maxTypes ?? 2;
  const suffix = options.mayExtend ? "+" : "";

  if (typeCounts.length === 0) return "no items";

  const named = typeCounts.slice(0, maxTypes);
  const rest = typeCounts.slice(maxTypes);

  const parts = named.map(
    ({ type, count }) => `${count}${suffix} ${nounFor(type, count)}`
  );

  if (rest.length > 0) {
    const remainder = rest.reduce((total, tc) => total + tc.count, 0);
    parts.push(`${remainder}${suffix} more`);
  }

  return joinWithAnd(parts);
}

function joinWithAnd(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** Total rows a run stands for. */
export function runItemCount(run: StreamRun<unknown>): number {
  return run.items.length;
}
