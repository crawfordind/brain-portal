/**
 * Writing and reading AI usage.
 *
 * Recording is best-effort by design: it must never fail, slow down noticeably
 * or change the result of the model call it describes. A database without the
 * tables (migration not run) simply records nothing.
 */

import type { Client } from "@libsql/client";
import { isMissingAiUsageTable } from "./schema";
import {
  EVENT_RETENTION_DAYS,
  MAX_EVENTS_PER_USER,
  PROMPT_PREVIEW_CHARS,
  type AiUsageEvent,
  type AiUsageEventView,
  type AiUsageReport,
  type AiUsageTotal,
  type UsageKind,
  type UsageProvider,
} from "./types";

type Db = Pick<Client, "execute" | "batch">;

async function defaultDb(): Promise<Db> {
  // Lazy for the same reason as `credentials/resolve.ts`.
  const { db } = await import("@/lib/db/client");
  return db;
}

/** Prune on roughly one write in 25, so the log stays bounded without a cron. */
const PRUNE_EVERY = 25;
let tablesMissing = false;

export async function recordAiUsage(event: AiUsageEvent, client?: Db): Promise<void> {
  if (tablesMissing || !event.userId) return;
  try {
    const db = client ?? (await defaultDb());
    const prompt = event.prompt.slice(0, PROMPT_PREVIEW_CHARS);
    const error = event.error ? event.error.replace(/sk-[A-Za-z0-9_-]{8,}/g, "[key]").slice(0, 500) : null;
    const statements: Array<{ sql: string; args: Array<string | number | null> }> = [
      {
        sql: `INSERT INTO ai_usage_events
                (user_id, provider, model, source, kind, slot, purpose, prompt, input_tokens, output_tokens, status, error, duration_ms)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          event.userId,
          event.provider,
          event.model,
          event.source,
          event.kind,
          event.slot,
          event.purpose.slice(0, 120),
          prompt,
          event.inputTokens,
          event.outputTokens,
          event.status,
          error,
          Math.max(0, Math.round(event.durationMs)),
        ],
      },
      {
        sql: `INSERT INTO ai_usage_totals (user_id, provider, model, source, calls, input_tokens, output_tokens)
              VALUES (?, ?, ?, ?, 1, ?, ?)
              ON CONFLICT (user_id, provider, model, source) DO UPDATE SET
                calls = calls + 1,
                input_tokens = input_tokens + excluded.input_tokens,
                output_tokens = output_tokens + excluded.output_tokens,
                last_used_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
        args: [event.userId, event.provider, event.model, event.source, event.inputTokens, event.outputTokens],
      },
    ];
    if (Math.random() * PRUNE_EVERY < 1) {
      statements.push(
        {
          sql: `DELETE FROM ai_usage_events WHERE user_id = ? AND julianday(created_at) < julianday('now', ?)`,
          args: [event.userId, `-${EVENT_RETENTION_DAYS} days`],
        },
        {
          sql: `DELETE FROM ai_usage_events WHERE user_id = ? AND id NOT IN (
                  SELECT id FROM ai_usage_events WHERE user_id = ? ORDER BY created_at DESC LIMIT ?)`,
          args: [event.userId, event.userId, MAX_EVENTS_PER_USER],
        }
      );
    }
    await db.batch(statements, "write");
  } catch (error) {
    if (isMissingAiUsageTable(error)) {
      tablesMissing = true;
      return;
    }
    console.warn("[AI usage] could not record a call:", error instanceof Error ? error.message : error);
  }
}

/** Test seam: forget that the tables were missing. */
export function resetUsageStoreState(): void {
  tablesMissing = false;
}

export async function getAiUsageReport(
  userId: string,
  options: { limit?: number; client?: Pick<Client, "execute"> } = {}
): Promise<AiUsageReport> {
  const db = options.client ?? (await defaultDb());
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  try {
    const [totals, recent] = await Promise.all([
      db.execute({
        sql: `SELECT provider, model, source, calls, input_tokens, output_tokens, first_used_at, last_used_at
              FROM ai_usage_totals WHERE user_id = ?
              ORDER BY (input_tokens + output_tokens) DESC, last_used_at DESC`,
        args: [userId],
      }),
      db.execute({
        sql: `SELECT id, created_at, provider, model, source, kind, slot, purpose, prompt,
                     input_tokens, output_tokens, status, error, duration_ms
              FROM ai_usage_events WHERE user_id = ?
              ORDER BY created_at DESC LIMIT ?`,
        args: [userId, limit],
      }),
    ]);
    return {
      available: true,
      totals: totals.rows.map(
        (r): AiUsageTotal => ({
          provider: String(r.provider) as UsageProvider,
          model: String(r.model),
          source: r.source === "server" ? "server" : "user",
          calls: Number(r.calls) || 0,
          inputTokens: Number(r.input_tokens) || 0,
          outputTokens: Number(r.output_tokens) || 0,
          firstUsedAt: String(r.first_used_at),
          lastUsedAt: String(r.last_used_at),
        })
      ),
      recent: recent.rows.map(
        (r): AiUsageEventView => ({
          id: String(r.id),
          createdAt: String(r.created_at),
          provider: String(r.provider) as UsageProvider,
          model: String(r.model),
          source: r.source === "server" ? "server" : "user",
          kind: String(r.kind) as UsageKind,
          slot: r.slot == null ? null : String(r.slot),
          purpose: String(r.purpose),
          prompt: String(r.prompt ?? ""),
          inputTokens: Number(r.input_tokens) || 0,
          outputTokens: Number(r.output_tokens) || 0,
          status: r.status === "error" ? "error" : "ok",
          error: r.error == null ? null : String(r.error),
          durationMs: Number(r.duration_ms) || 0,
        })
      ),
    };
  } catch (error) {
    if (isMissingAiUsageTable(error)) return { available: false, totals: [], recent: [] };
    throw error;
  }
}

/** Start over: clears the log and the totals for one account. */
export async function resetAiUsage(userId: string, client?: Db): Promise<void> {
  const db = client ?? (await defaultDb());
  await db.batch(
    [
      { sql: `DELETE FROM ai_usage_events WHERE user_id = ?`, args: [userId] },
      { sql: `DELETE FROM ai_usage_totals WHERE user_id = ?`, args: [userId] },
    ],
    "write"
  );
}
