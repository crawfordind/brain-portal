/**
 * Client-safe system-health types and report formatting.
 *
 * Kept apart from `index.ts` so the panel component can import them without
 * dragging the database client into the browser bundle.
 */

import type { Diagnosis } from "./diagnose";

export type IssueKind =
  | "agent_task"
  | "queue_job"
  | "heartbeat"
  | "skill"
  | "configuration";

export interface SystemIssue {
  /** Stable across polls for the same underlying problem — used for dismissal. */
  signature: string;
  kind: IssueKind;
  /** Human name of the affected subsystem, e.g. "AI delegation". */
  subsystem: string;
  /** What specifically is affected — a task title, or a job description. */
  subject: string;
  diagnosis: Diagnosis;
  /** Redacted raw error, empty when the problem was inferred rather than thrown. */
  rawError: string;
  /** Timestamp of the most recent occurrence. */
  occurredAt: string;
  /** How many items share this exact problem. */
  count: number;
  /** Agent task id, when this issue maps to one retryable task. */
  retryTargetId?: string;
  /** Where in the app the user can look at the affected item. */
  actionUrl?: string;
}

export interface SystemHealth {
  status: "ok" | "degraded" | "down";
  issueCount: number;
  errorCount: number;
  warningCount: number;
  issues: SystemIssue[];
  checkedAt: string;
  /** One-line summary suitable for a tooltip. */
  summary: string;
}

/**
 * Report text the user can hand to whoever administers the deployment.
 * Deliberately plain text — it gets pasted into a chat, an email, or an issue.
 */
export function formatAdminReport(health: SystemHealth, appVersion?: string): string {
  const lines: string[] = [
    "Brain Portal — background system report",
    `Generated: ${health.checkedAt}`,
    appVersion ? `Version: ${appVersion}` : "",
    `Status: ${health.status} (${health.errorCount} error${health.errorCount === 1 ? "" : "s"}, ${health.warningCount} warning${health.warningCount === 1 ? "" : "s"})`,
    "",
  ].filter(Boolean);

  if (health.issues.length === 0) {
    lines.push("No issues detected.");
    return lines.join("\n");
  }

  health.issues.forEach((issue, index) => {
    lines.push(`${index + 1}. [${issue.diagnosis.code}] ${issue.diagnosis.title}`);
    lines.push(`   Subsystem: ${issue.subsystem}`);
    lines.push(`   Affected: ${issue.subject}`);
    lines.push(`   Occurrences: ${issue.count}`);
    lines.push(`   Last seen: ${issue.occurredAt}`);
    lines.push(`   Fix: ${issue.diagnosis.adminHint}`);
    if (issue.rawError) lines.push(`   Raw error: ${issue.rawError}`);
    lines.push("");
  });

  return lines.join("\n");
}
