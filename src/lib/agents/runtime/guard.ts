/**
 * Request guards for the delegated-task routes: per-user rate limits and input checks.
 *
 * The app-wide limiter in `src/lib/rate-limit.ts` is keyed by client IP and
 * shares one bucket across every route that uses it. These actions start real
 * work (a paid model call, or an agent with tools), so they are limited per
 * *user* and per action.
 * Same caveat as that limiter: in-process, so the effective ceiling is
 * roughly limit × serverless instances. It bounds accidents and loops, which
 * is what it is for; a Hermes agent's own concurrent-run cap is a further backstop.
 */

import { queryAll, queryOne } from "@/lib/db/client";

export type RuntimeAction = "create" | "send" | "revise" | "cancel" | "approval" | "poll" | "check";

const LIMITS: Record<RuntimeAction, { max: number; windowMs: number }> = {
  create: { max: 20, windowMs: 10 * 60_000 },
  send: { max: 20, windowMs: 10 * 60_000 },
  revise: { max: 30, windowMs: 10 * 60_000 },
  cancel: { max: 30, windowMs: 10 * 60_000 },
  approval: { max: 60, windowMs: 10 * 60_000 },
  poll: { max: 240, windowMs: 10 * 60_000 },
  check: { max: 10, windowMs: 10 * 60_000 },
};

const buckets = new Map<string, { count: number; resetAt: number }>();

export function checkRuntimeRateLimit(
  userId: string,
  action: RuntimeAction,
  now: number = Date.now()
): { allowed: boolean; retryAfterSeconds: number } {
  if (buckets.size > 5_000) {
    for (const [key, value] of buckets) if (now > value.resetAt) buckets.delete(key);
  }
  const { max, windowMs } = LIMITS[action];
  const key = `${action}:${userId}`;
  let bucket = buckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  return {
    allowed: bucket.count <= max,
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

/** Test hook. */
export function resetRuntimeRateLimits(): void {
  buckets.clear();
}

export const INPUT_LIMITS = {
  title: 300,
  description: 8_000,
  feedback: 4_000,
  contextNotes: 5,
  urls: 10,
  url: 2_048,
} as const;

export const AGENT_TYPES = [
  "code", "copy", "research", "marketing", "analyst", "general", "ux", "legal", "finance", "hr",
  "product", "sales", "operations", "security", "data_eng", "educator", "strategy",
] as const;
export const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export const OUTPUT_FORMATS = ["markdown", "code", "plain_text", "structured"] as const;

/** Source types a delegated task may point at, and the table that owns each. */
export const SOURCE_TABLES = {
  task: "tasks",
  note: "notes",
  journal: "notes",
  capture: "captures",
  thought: "captures",
  reminder: "reminders",
  insight: "insights",
  project: "projects",
  contact: "entities",
} as const;
export type DelegationSource = keyof typeof SOURCE_TABLES;

export function isSourceType(value: unknown): value is DelegationSource {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(SOURCE_TABLES, value);
}

/**
 * Tables to try, in order, for a source type. The stream labels a capture
 * whose type is task-like as a `task`, and a dated task as a `reminder`, so
 * those types can live in more than one table (the chat resolves items the
 * same way; see `src/lib/chat/item-context.ts`).
 */
const SOURCE_CANDIDATES: Partial<Record<DelegationSource, DelegationSource[]>> = {
  task: ["task", "capture"],
  reminder: ["reminder", "task"],
  thought: ["capture"],
};

/** The source type the id actually belongs to, for this user, or null. */
export async function resolveOwnedSource(
  userId: string,
  type: DelegationSource,
  id: string
): Promise<DelegationSource | null> {
  for (const candidate of SOURCE_CANDIDATES[type] ?? [type]) {
    if (await ownsRecord(userId, candidate, id)) return candidate;
  }
  return null;
}

/** True only if `userId` owns the row. Browser-supplied ids are never trusted otherwise. */
export async function ownsRecord(userId: string, type: DelegationSource, id: string): Promise<boolean> {
  const table = SOURCE_TABLES[type];
  const row = await queryOne<{ ok: number }>(
    `SELECT 1 AS ok FROM ${table} WHERE id = ? AND user_id = ? LIMIT 1`,
    [id, userId]
  );
  return !!row;
}

/** The subset of `noteIds` the user owns, in the order given. */
export async function ownedNoteIds(userId: string, noteIds: string[]): Promise<string[]> {
  if (noteIds.length === 0) return [];
  const rows = await queryAll<{ id: string }>(
    `SELECT id FROM notes WHERE user_id = ? AND id IN (${noteIds.map(() => "?").join(", ")})`,
    [userId, ...noteIds]
  );
  const owned = new Set(rows.map((r) => r.id));
  return noteIds.filter((id) => owned.has(id));
}

export function cleanUrls(raw: unknown): string[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return null;
  const urls: string[] = [];
  for (const value of raw) {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed) continue;
    if (trimmed.length > INPUT_LIMITS.url) return null;
    try {
      const url = new URL(trimmed);
      if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    } catch {
      return null;
    }
    urls.push(trimmed);
  }
  return urls.length > INPUT_LIMITS.urls ? null : urls;
}

export function cleanIdList(raw: unknown, max: number): string[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > max) return null;
  if (!raw.every((v) => typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v))) return null;
  return [...new Set(raw as string[])];
}
