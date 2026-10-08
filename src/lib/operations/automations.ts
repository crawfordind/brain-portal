/**
 * Automation health: an executive-level view of what runs in the background.
 *
 * Every status is computed from evidence already in the database: the rows a
 * job leaves behind when it runs. Where a job leaves no trace, the status is
 * `unknown` and says so — it is never reported healthy on faith. n8n has no
 * integration with this app yet, so it is listed as `not_connected` rather
 * than pretended.
 *
 * Quiet by default: `alertsOnly` keeps only what needs a human — failing and
 * degraded. Healthy, paused and unobservable jobs stay on the Automations page
 * and off the home screen, so a healthy system shows nothing there.
 *
 * The detailed per-issue diagnosis stays in `getSystemHealth`
 * (`src/lib/system-health`); this module is the map, that one is the report.
 */

import { query, queryOne } from "@/lib/db/client";
import type { AutomationHealth, AutomationStatus } from "./types";

/** A job that should run every few minutes has missed runs after this long. */
const STALL_MINUTES = 20;
const FAILURE_WINDOW_HOURS = 24;

export interface QueueEvidence {
  lastSuccessAt: string | null;
  lastRunAt: string | null;
  failures: number;
  /** Oldest item that has been waiting longer than the stall threshold. */
  stalledSince: string | null;
  stalledCount: number;
}

/**
 * Pure verdict for a queue-drained job. A stall outranks failures: work that
 * never starts produces no error row at all, so it is the quieter and more
 * dangerous failure.
 */
export function judgeQueue(
  evidence: QueueEvidence,
  noun: string
): { status: AutomationStatus; signal: string } {
  if (evidence.stalledCount > 0) {
    return {
      status: "failing",
      signal: `${evidence.stalledCount} ${noun} waiting more than ${STALL_MINUTES} minutes — the scheduled run may not be firing`,
    };
  }
  if (evidence.failures >= 3) {
    return {
      status: "failing",
      signal: `${evidence.failures} failures in the last ${FAILURE_WINDOW_HOURS} hours`,
    };
  }
  if (evidence.failures > 0) {
    return {
      status: "degraded",
      signal: `${evidence.failures} failure${evidence.failures === 1 ? "" : "s"} in the last ${FAILURE_WINDOW_HOURS} hours`,
    };
  }
  if (!evidence.lastRunAt) {
    return { status: "unknown", signal: "No runs recorded yet" };
  }
  return { status: "healthy", signal: "" };
}

export interface RuleEvidence {
  enabled: boolean;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  recentErrors: number;
}

export function judgeRule(evidence: RuleEvidence): { status: AutomationStatus; signal: string } {
  if (!evidence.enabled) return { status: "paused", signal: "Turned off" };
  if (evidence.recentErrors >= 3) {
    return {
      status: "failing",
      signal: evidence.lastError
        ? `Failing repeatedly: ${evidence.lastError.slice(0, 160)}`
        : `${evidence.recentErrors} errors in the last ${FAILURE_WINDOW_HOURS} hours`,
    };
  }
  if (evidence.lastStatus === "error") {
    return {
      status: "degraded",
      signal: evidence.lastError ? `Last run failed: ${evidence.lastError.slice(0, 160)}` : "Last run failed",
    };
  }
  if (!evidence.lastRunAt) return { status: "unknown", signal: "Has not run yet" };
  return { status: "healthy", signal: "" };
}

async function probeOne<T>(fn: () => Promise<T | null>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

async function probeMany<T>(fn: () => Promise<T[]>): Promise<T[]> {
  try {
    return await fn();
  } catch {
    return [];
  }
}

async function contentQueue(userId: string): Promise<AutomationHealth> {
  const row = await probeOne(() =>
    queryOne<{
      last_success: string | null;
      last_run: string | null;
      failures: number;
      stalled: number;
      stalled_since: string | null;
    }>(
      `SELECT
         MAX(CASE WHEN status = 'completed' THEN completed_at END) AS last_success,
         MAX(COALESCE(completed_at, started_at)) AS last_run,
         SUM(CASE WHEN status = 'failed' AND COALESCE(completed_at, started_at, scheduled_at) >= datetime('now', '-${FAILURE_WINDOW_HOURS} hours') THEN 1 ELSE 0 END) AS failures,
         SUM(CASE WHEN status = 'pending' AND scheduled_at < datetime('now', '-${STALL_MINUTES} minutes')
                   AND operation IN ('generate_embedding','generate_summary','generate_tags','find_connections','scan_for_tasks','link-scrape-and-embed','extract-interactions')
                  THEN 1 ELSE 0 END) AS stalled,
         MIN(CASE WHEN status = 'pending' THEN scheduled_at END) AS stalled_since
       FROM processing_queue WHERE user_id = ?`,
      [userId]
    )
  );
  const evidence: QueueEvidence = {
    lastSuccessAt: row?.last_success ?? null,
    lastRunAt: row?.last_run ?? null,
    failures: Number(row?.failures) || 0,
    stalledCount: Number(row?.stalled) || 0,
    stalledSince: row?.stalled_since ?? null,
  };
  const verdict = judgeQueue(evidence, "content jobs");
  return {
    id: "content-queue",
    name: "Search & contact indexing",
    purpose:
      "Every 5 minutes: makes new notes searchable, tags and connects them, and reads them for contacts and touch points.",
    status: verdict.status,
    signal: verdict.signal,
    lastSuccessAt: evidence.lastSuccessAt,
    lastRunAt: evidence.lastRunAt,
    owner: "Brain Portal (search, CRM)",
    recentFailures: evidence.failures,
  };
}

async function agentQueue(userId: string): Promise<AutomationHealth> {
  const row = await probeOne(() =>
    queryOne<{ last_success: string | null; last_run: string | null; failures: number; stalled: number }>(
      `SELECT
         MAX(CASE WHEN status IN ('awaiting_review','approved') THEN updated_at END) AS last_success,
         MAX(CASE WHEN status <> 'queued' THEN updated_at END) AS last_run,
         SUM(CASE WHEN status = 'failed' AND updated_at >= datetime('now', '-${FAILURE_WINDOW_HOURS} hours') THEN 1 ELSE 0 END) AS failures,
         SUM(CASE WHEN status = 'queued' AND created_at < datetime('now', '-${STALL_MINUTES} minutes') THEN 1 ELSE 0 END) AS stalled
       FROM agent_tasks WHERE user_id = ?`,
      [userId]
    )
  );
  const evidence: QueueEvidence = {
    lastSuccessAt: row?.last_success ?? null,
    lastRunAt: row?.last_run ?? null,
    failures: Number(row?.failures) || 0,
    stalledCount: Number(row?.stalled) || 0,
    stalledSince: null,
  };
  const verdict = judgeQueue(evidence, "agent tasks");
  return {
    id: "agent-queue",
    name: "Background agents",
    purpose: "Every minute: runs delegated agent work and puts the output in Review.",
    status: verdict.status,
    signal: verdict.signal,
    lastSuccessAt: evidence.lastSuccessAt,
    lastRunAt: evidence.lastRunAt,
    owner: "Review queue",
    recentFailures: evidence.failures,
    href: "/review",
  };
}

async function heartbeatRules(userId: string): Promise<AutomationHealth[]> {
  const rules = await probeMany(() =>
    query<{
      id: string;
      name: string;
      description: string;
      enabled: number;
      last_run_at: string | null;
      owner: string;
    }>(
      `SELECT id, name, description, enabled, last_run_at, owner FROM heartbeat_tasks
       WHERE user_id = ? ORDER BY name`,
      [userId]
    )
  );
  if (rules.length === 0) return [];

  const logs = await probeMany(() =>
    query<{
      heartbeat_task_id: string;
      status: string;
      error_message: string | null;
      tick_time: string;
    }>(
      `SELECT heartbeat_task_id, status, error_message, tick_time FROM heartbeat_logs
       WHERE user_id = ? AND tick_time >= datetime('now', '-${FAILURE_WINDOW_HOURS} hours')
       ORDER BY tick_time DESC`,
      [userId]
    )
  );

  return rules.map((rule) => {
    const own = logs.filter((l) => String(l.heartbeat_task_id) === String(rule.id));
    const last = own[0];
    const lastOk = own.find((l) => l.status !== "error");
    const verdict = judgeRule({
      enabled: !!Number(rule.enabled),
      lastRunAt: rule.last_run_at,
      lastStatus: last?.status ?? null,
      lastError: own.find((l) => l.status === "error")?.error_message ?? null,
      recentErrors: own.filter((l) => l.status === "error").length,
    });
    return {
      id: `heartbeat:${rule.id}`,
      name: rule.name,
      purpose: rule.description,
      status: verdict.status,
      signal: verdict.signal,
      lastSuccessAt: lastOk?.tick_time ?? (last ? null : rule.last_run_at),
      lastRunAt: rule.last_run_at,
      owner: rule.owner === "user" ? "You (heartbeat rule)" : "Brain Portal (heartbeat rule)",
      recentFailures: own.filter((l) => l.status === "error").length,
    };
  });
}

async function skills(userId: string): Promise<AutomationHealth | null> {
  const row = await probeOne(() =>
    queryOne<{ last_success: string | null; last_run: string | null; failures: number; runs: number }>(
      `SELECT
         MAX(CASE WHEN status = 'completed' THEN created_at END) AS last_success,
         MAX(created_at) AS last_run,
         SUM(CASE WHEN status = 'failed' AND created_at >= datetime('now', '-${FAILURE_WINDOW_HOURS} hours') THEN 1 ELSE 0 END) AS failures,
         COUNT(*) AS runs
       FROM skill_executions WHERE user_id = ? AND trigger_source <> 'manual'`,
      [userId]
    )
  );
  if (!row || !Number(row.runs)) return null;
  const evidence: QueueEvidence = {
    lastSuccessAt: row.last_success,
    lastRunAt: row.last_run,
    failures: Number(row.failures) || 0,
    stalledCount: 0,
    stalledSince: null,
  };
  const verdict = judgeQueue(evidence, "skill runs");
  return {
    id: "skills",
    name: "Scheduled skills",
    purpose: "Skills triggered by heartbeat rules and agents (digests, triage, insights).",
    status: verdict.status,
    signal: verdict.signal,
    lastSuccessAt: evidence.lastSuccessAt,
    lastRunAt: evidence.lastRunAt,
    owner: "Heartbeat rules",
    recentFailures: evidence.failures,
  };
}

function configuration(): AutomationHealth[] {
  const isProd = process.env.NODE_ENV === "production";
  const results: AutomationHealth[] = [];
  if (isProd && !process.env.CRON_SECRET) {
    results.push({
      id: "cron-secret",
      name: "Scheduled jobs",
      purpose: "Every /api/cron/* run is authorised by CRON_SECRET.",
      status: "failing",
      signal: "CRON_SECRET is not set, so every scheduled run is refused. Nothing in the background is running.",
      lastSuccessAt: null,
      lastRunAt: null,
      owner: "Deployment settings",
      recentFailures: 0,
    });
  }
  if (!process.env.OPENROUTER_API_KEY) {
    results.push({
      id: "ai-provider",
      name: "AI provider",
      purpose: "Summaries, agents, contact extraction and search all call OpenRouter.",
      status: "failing",
      signal: "OPENROUTER_API_KEY is not set, so every AI step fails.",
      lastSuccessAt: null,
      lastRunAt: null,
      owner: "Deployment settings",
      recentFailures: 0,
    });
  }
  return results;
}

/** Jobs that keep no run record. Listed honestly, never reported healthy. */
const UNOBSERVED: AutomationHealth[] = [
  {
    id: "notifications",
    name: "Reminders & email alerts",
    purpose: "Every 15 minutes: sends due reminders, overdue-task alerts and the daily digest.",
    status: "unknown",
    signal: "This job keeps no run log, so its health cannot be confirmed from here.",
    lastSuccessAt: null,
    lastRunAt: null,
    owner: "Your inbox",
    recentFailures: 0,
  },
  {
    id: "project-health",
    name: "Weekly project health",
    purpose: "Mondays 09:00 UTC: writes a health insight for each project.",
    status: "unknown",
    signal: "This job keeps no run log, so its health cannot be confirmed from here.",
    lastSuccessAt: null,
    lastRunAt: null,
    owner: "Projects",
    recentFailures: 0,
  },
  {
    id: "n8n",
    name: "n8n workflows",
    purpose: "External workflows (content, intake, integrations).",
    status: "not_connected",
    signal:
      "Brain Portal has no connection to n8n yet, so workflow outcomes are not reported here. Nothing is being monitored.",
    lastSuccessAt: null,
    lastRunAt: null,
    owner: "External",
    recentFailures: 0,
  },
];

const STATUS_RANK: Record<AutomationStatus, number> = {
  failing: 0,
  degraded: 1,
  paused: 2,
  unknown: 3,
  healthy: 4,
  not_connected: 5,
};

export async function getAutomationHealth(userId: string): Promise<AutomationHealth[]> {
  const [content, agents, rules, skill] = await Promise.all([
    contentQueue(userId),
    agentQueue(userId),
    heartbeatRules(userId),
    skills(userId),
  ]);
  const all = [
    ...configuration(),
    content,
    agents,
    ...rules,
    ...(skill ? [skill] : []),
    ...UNOBSERVED,
  ];
  return all.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status]);
}

/** What deserves a human's attention. Normal success, unknown and paused stay quiet. */
export function alertsOnly(list: AutomationHealth[]): AutomationHealth[] {
  return list.filter((a) => a.status === "failing" || a.status === "degraded");
}
