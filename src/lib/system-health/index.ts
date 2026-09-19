/**
 * System Health — why background work isn't happening.
 *
 * The agentic side of the app (delegation, embeddings, heartbeat, skills) runs
 * out of band. When it breaks, the user's only signal used to be that nothing
 * ever came back. This module inspects the actual state of every background
 * subsystem and turns it into a short list of user-readable issues, so a red
 * indicator can appear in the header with a concrete reason attached.
 *
 * It reports three classes of problem:
 *  1. Things that failed and said why  (agent tasks, queue jobs, skills, heartbeat)
 *  2. Things that never ran at all     (work stalled in a queue nobody drains)
 *  3. Things that cannot possibly work (missing provider key, unseeded agents)
 *
 * Class 2 is the one that used to be completely invisible: a stalled job has no
 * error message, so nothing ever surfaced it.
 */

import { queryAll } from "@/lib/db/client";
import {
  diagnoseError,
  diagnosisFor,
  redactSecrets,
  type Diagnosis,
  type DiagnosisCode,
} from "./diagnose";
import type { SystemHealth, SystemIssue } from "./types";

export type { Diagnosis, DiagnosisCode } from "./diagnose";
export type { IssueKind, SystemHealth, SystemIssue } from "./types";
export { formatAdminReport } from "./types";

/** Work sitting un-started for longer than this means nothing is draining the queue. */
const STALL_MINUTES = 20;
/** A task held in 'processing' this long has lost its worker. */
const STUCK_MINUTES = 15;
/** How far back failures stay interesting. */
const LOOKBACK_HOURS = 72;
/** Cap so one broken subsystem can't flood the panel. */
const MAX_ISSUES = 25;

const LOOKBACK = `-${LOOKBACK_HOURS} hours`;

/**
 * Run a probe, swallowing "table doesn't exist" style failures.
 * Health checks must never be the reason a page breaks, and deployments that
 * skipped an optional migration should still get the checks that do apply.
 */
async function probe<T>(fn: () => Promise<T[]>): Promise<T[]> {
  try {
    return await fn();
  } catch (error) {
    console.error("[SystemHealth] probe failed:", error);
    return [];
  }
}

function issueSignature(parts: (string | undefined)[]): string {
  return parts.filter(Boolean).join(":");
}

// ─── Probe: agent delegation ─────────────────────────

interface AgentTaskRow {
  id: string;
  title: string;
  assigned_agent: string;
  status: string;
  last_error: string | null;
  retry_count: number;
  max_retries: number;
  updated_at: string;
}

async function checkAgentTasks(userId: string): Promise<SystemIssue[]> {
  const issues: SystemIssue[] = [];

  const failed = await probe(() =>
    queryAll<AgentTaskRow>(
      `SELECT id, title, assigned_agent, status, last_error, retry_count, max_retries, updated_at
         FROM agent_tasks
        WHERE user_id = ? AND status = 'failed'
          AND updated_at > datetime('now', ?)
        ORDER BY updated_at DESC
        LIMIT 50`,
      [userId, LOOKBACK]
    )
  );

  // Group by diagnosis: ten tasks killed by one missing API key is one problem,
  // not ten. The most recent one supplies the example detail.
  const byCode = new Map<DiagnosisCode, { rows: AgentTaskRow[]; diagnosis: Diagnosis }>();
  for (const row of failed) {
    const diagnosis = diagnoseError(row.last_error);
    const bucket = byCode.get(diagnosis.code);
    if (bucket) bucket.rows.push(row);
    else byCode.set(diagnosis.code, { rows: [row], diagnosis });
  }

  for (const [code, { rows, diagnosis }] of byCode) {
    const latest = rows[0];
    const exhausted = rows.every((r) => (r.retry_count ?? 0) >= (r.max_retries ?? 3));
    issues.push({
      signature: issueSignature(["agent_task", code, latest.updated_at]),
      kind: "agent_task",
      subsystem: "AI delegation",
      subject:
        rows.length > 1
          ? `${rows.length} agent tasks failed, including "${latest.title}"`
          : `"${latest.title}" (${latest.assigned_agent} agent)`,
      diagnosis: exhausted
        ? { ...diagnosis, severity: "error" }
        : diagnosis,
      rawError: redactSecrets(latest.last_error),
      occurredAt: latest.updated_at,
      count: rows.length,
      retryTargetId: rows.length === 1 ? latest.id : undefined,
      actionUrl: "/review",
    });
  }

  // Stalled: created but never claimed. No error text exists for these, which is
  // exactly why they were invisible before.
  const stalled = await probe(() =>
    queryAll<{ n: number; oldest: string; sample: string }>(
      `SELECT COUNT(*) as n, MIN(updated_at) as oldest, MIN(title) as sample
         FROM agent_tasks
        WHERE user_id = ? AND status IN ('queued', 'revision_requested')
          AND updated_at < datetime('now', ?)`,
      [userId, `-${STALL_MINUTES} minutes`]
    )
  );
  if (stalled[0]?.n > 0) {
    const row = stalled[0];
    issues.push({
      signature: issueSignature(["agent_stalled", row.oldest]),
      kind: "agent_task",
      subsystem: "AI delegation",
      subject:
        row.n > 1
          ? `${row.n} delegated tasks have been waiting over ${STALL_MINUTES} minutes`
          : `"${row.sample}" has been waiting over ${STALL_MINUTES} minutes`,
      diagnosis: diagnosisFor("WORKER_NOT_RUNNING"),
      rawError: "",
      occurredAt: row.oldest,
      count: row.n,
      actionUrl: "/review",
    });
  }

  // Stuck: claimed by a worker that died mid-run.
  const stuck = await probe(() =>
    queryAll<{ n: number; oldest: string; sample: string }>(
      `SELECT COUNT(*) as n, MIN(updated_at) as oldest, MIN(title) as sample
         FROM agent_tasks
        WHERE user_id = ? AND status = 'processing'
          AND updated_at < datetime('now', ?)`,
      [userId, `-${STUCK_MINUTES} minutes`]
    )
  );
  if (stuck[0]?.n > 0) {
    const row = stuck[0];
    issues.push({
      signature: issueSignature(["agent_stuck", row.oldest]),
      kind: "agent_task",
      subsystem: "AI delegation",
      subject:
        row.n > 1
          ? `${row.n} agent tasks have been running for over ${STUCK_MINUTES} minutes`
          : `"${row.sample}" has been running for over ${STUCK_MINUTES} minutes`,
      diagnosis: {
        ...diagnosisFor("AI_TIMEOUT"),
        title: "An agent task stopped part-way through",
        explanation:
          "The server started this work but never finished it — usually because the request hit its time limit. It is normally picked up and retried automatically within a few minutes.",
      },
      rawError: "",
      occurredAt: row.oldest,
      count: row.n,
      actionUrl: "/review",
    });
  }

  return issues;
}

// ─── Probe: background processing queue ──────────────

async function checkProcessingQueue(userId: string): Promise<SystemIssue[]> {
  const issues: SystemIssue[] = [];

  const failed = await probe(() =>
    queryAll<{ operation: string; error_message: string | null; n: number; latest: string }>(
      `SELECT operation, error_message, COUNT(*) as n, MAX(completed_at) as latest
         FROM processing_queue
        WHERE user_id = ? AND status = 'failed'
          AND attempts >= max_attempts
          AND COALESCE(completed_at, scheduled_at) > datetime('now', ?)
        GROUP BY operation, error_message
        ORDER BY n DESC
        LIMIT 10`,
      [userId, LOOKBACK]
    )
  );

  for (const row of failed) {
    const diagnosis = diagnoseError(row.error_message);
    issues.push({
      signature: issueSignature(["queue", row.operation, diagnosis.code]),
      kind: "queue_job",
      subsystem: "Background processing",
      subject: `${row.n} "${humanizeOperation(row.operation)}" job${row.n === 1 ? "" : "s"} gave up after retrying`,
      diagnosis,
      rawError: redactSecrets(row.error_message),
      occurredAt: row.latest || new Date().toISOString(),
      count: row.n,
    });
  }

  // `attempts < max_attempts` matters as much as the age does. The worker only
  // claims jobs that still have a retry left, so a 'pending' row that has spent
  // them all is not waiting on the worker — it is unreachable by it. Counting
  // those as a backlog reported "nothing is draining the queue" forever, on
  // instances where the queue was draining fine. The cron now retires such rows
  // to 'failed', where the probe above reports them with their error; this
  // clause keeps a pre-existing one from raising the alarm in the meantime.
  const backlog = await probe(() =>
    queryAll<{ n: number; oldest: string }>(
      `SELECT COUNT(*) as n, MIN(scheduled_at) as oldest
         FROM processing_queue
        WHERE user_id = ? AND status = 'pending'
          AND attempts < max_attempts
          AND scheduled_at < datetime('now', ?)`,
      [userId, `-${STALL_MINUTES} minutes`]
    )
  );
  if (backlog[0]?.n > 0) {
    const row = backlog[0];
    issues.push({
      signature: issueSignature(["queue_backlog", row.oldest]),
      kind: "queue_job",
      subsystem: "Background processing",
      subject: `${row.n} background job${row.n === 1 ? " has" : "s have"} been queued for over ${STALL_MINUTES} minutes`,
      diagnosis: {
        ...diagnosisFor("WORKER_NOT_RUNNING"),
        explanation:
          "Search indexing, summaries, and tags are queued but never run, so new notes stay unsearchable and untagged. This is a server-side scheduling problem, not something you can fix from the app.",
      },
      rawError: "",
      occurredAt: row.oldest,
      count: row.n,
    });
  }

  return issues;
}

function humanizeOperation(operation: string): string {
  return operation.replace(/[-_]/g, " ");
}

// ─── Probe: heartbeat + skills ───────────────────────

async function checkHeartbeat(userId: string): Promise<SystemIssue[]> {
  const rows = await probe(() =>
    queryAll<{ error_message: string | null; n: number; latest: string }>(
      `SELECT error_message, COUNT(*) as n, MAX(created_at) as latest
         FROM heartbeat_logs
        WHERE user_id = ? AND status = 'error'
          AND created_at > datetime('now', ?)
        GROUP BY error_message
        ORDER BY n DESC
        LIMIT 5`,
      [userId, LOOKBACK]
    )
  );

  return rows.map((row) => {
    const diagnosis = diagnoseError(row.error_message);
    return {
      signature: issueSignature(["heartbeat", diagnosis.code]),
      kind: "heartbeat" as const,
      subsystem: "Automations",
      subject: `${row.n} automation tick${row.n === 1 ? "" : "s"} failed`,
      diagnosis,
      rawError: redactSecrets(row.error_message),
      occurredAt: row.latest,
      count: row.n,
    };
  });
}

async function checkSkills(userId: string): Promise<SystemIssue[]> {
  const rows = await probe(() =>
    queryAll<{ skill_id: string; error_message: string | null; n: number; latest: string }>(
      `SELECT skill_id, error_message, COUNT(*) as n, MAX(created_at) as latest
         FROM skill_executions
        WHERE user_id = ? AND status = 'failed'
          AND created_at > datetime('now', ?)
        GROUP BY skill_id, error_message
        ORDER BY n DESC
        LIMIT 5`,
      [userId, LOOKBACK]
    )
  );

  return rows.map((row) => {
    const diagnosis = diagnoseError(row.error_message);
    return {
      signature: issueSignature(["skill", row.skill_id, diagnosis.code]),
      kind: "skill" as const,
      subsystem: "Skills",
      subject: `Skill "${row.skill_id}" failed ${row.n} time${row.n === 1 ? "" : "s"}`,
      diagnosis,
      rawError: redactSecrets(row.error_message),
      occurredAt: row.latest,
      count: row.n,
    };
  });
}

// ─── Probe: configuration ────────────────────────────

/**
 * Catches the failures that never even produce an error row, because no work
 * can be attempted at all. Only ever reads presence of env vars — never values.
 */
async function checkConfiguration(): Promise<SystemIssue[]> {
  const issues: SystemIssue[] = [];
  const now = new Date().toISOString();

  if (!process.env.OPENROUTER_API_KEY) {
    issues.push({
      signature: "config:AI_KEY_MISSING",
      kind: "configuration",
      subsystem: "Server configuration",
      subject: "No AI provider key is set on the server",
      diagnosis: diagnosisFor("AI_KEY_MISSING"),
      rawError: "",
      occurredAt: now,
      count: 1,
    });
  }

  if (!process.env.CRON_SECRET && process.env.NODE_ENV === "production") {
    issues.push({
      signature: "config:CRON_SECRET",
      kind: "configuration",
      subsystem: "Server configuration",
      subject: "Scheduled background jobs are rejected by the server",
      diagnosis: {
        ...diagnosisFor("WORKER_NOT_RUNNING"),
        explanation:
          "The scheduled jobs that run AI agents and index your notes are refused because the server has no shared secret configured. Delegated work will queue up and never start.",
        adminHint:
          "CRON_SECRET is unset in production, so every /api/cron/* request is answered with 401. Set CRON_SECRET in the deployment environment and redeploy.",
      },
      rawError: "",
      occurredAt: now,
      count: 1,
    });
  }

  const agentCount = await probe(() =>
    queryAll<{ n: number }>(`SELECT COUNT(*) as n FROM agent_configs WHERE is_active = 1`)
  );
  if (agentCount.length > 0 && agentCount[0].n === 0) {
    issues.push({
      signature: "config:AGENT_NOT_CONFIGURED",
      kind: "configuration",
      subsystem: "Server configuration",
      subject: "No AI agents are configured on this server",
      diagnosis: diagnosisFor("AGENT_NOT_CONFIGURED"),
      rawError: "",
      occurredAt: now,
      count: 1,
    });
  }

  return issues;
}

// ─── Aggregate ───────────────────────────────────────

export async function getSystemHealth(userId: string): Promise<SystemHealth> {
  const [agentIssues, queueIssues, heartbeatIssues, skillIssues, configIssues] =
    await Promise.all([
      checkAgentTasks(userId),
      checkProcessingQueue(userId),
      checkHeartbeat(userId),
      checkSkills(userId),
      checkConfiguration(),
    ]);

  // Configuration problems are the root cause of everything else, so they lead.
  const issues = [
    ...configIssues,
    ...agentIssues,
    ...queueIssues,
    ...heartbeatIssues,
    ...skillIssues,
  ]
    .sort((a, b) => severityRank(b) - severityRank(a))
    .slice(0, MAX_ISSUES);

  const errorCount = issues.filter((i) => i.diagnosis.severity === "error").length;
  const warningCount = issues.length - errorCount;

  return {
    status: errorCount > 0 ? "down" : warningCount > 0 ? "degraded" : "ok",
    issueCount: issues.length,
    errorCount,
    warningCount,
    issues,
    checkedAt: new Date().toISOString(),
    summary: buildSummary(issues, errorCount, warningCount),
  };
}

function severityRank(issue: SystemIssue): number {
  const base = issue.diagnosis.severity === "error" ? 100 : 0;
  return base + (issue.kind === "configuration" ? 10 : 0);
}

function buildSummary(issues: SystemIssue[], errors: number, warnings: number): string {
  if (issues.length === 0) return "All background systems are running normally.";
  if (errors > 0) return issues[0].diagnosis.title;
  return `${warnings} background ${warnings === 1 ? "issue" : "issues"} need attention`;
}
