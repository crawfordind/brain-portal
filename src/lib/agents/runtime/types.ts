/**
 * Delegated-task lifecycle: the vocabulary and the pure rules over it.
 *
 * Shared by every runtime (OpenRouter, Hermes) and by the browser, the route
 * handlers, the cron and the tests, so it imports nothing, for the same reason
 * `chat/item-types.ts` and `provenance/types.ts` don't.
 *
 * `agent_tasks.status` carries a CHECK constraint, and widening it means
 * rebuilding a table two others cascade from. So the precise state lives in
 * `agent_tasks.runtime_state`, and `status` stays the coarse projection every
 * existing reader already understands. `coarseStatus` is the only place that
 * projection is decided.
 */

/** Runtimes that can execute a delegated task. Chosen by `AGENT_RUNTIME`. */
export const RUNTIME_NAMES = ["openrouter", "hermes"] as const;
export type RuntimeName = (typeof RUNTIME_NAMES)[number];

export const TASK_STATES = [
  /** Accepted and deliberately not sent: delegation is off, or migrated legacy work. */
  "needs_dispatch",
  /** Could not be mapped to a runnable task safely; `last_error` says why. */
  "needs_review",
  /** Accepted by Brain Portal, not yet handed to the runtime. */
  "queued",
  /** Submit in flight, or being retried with the same idempotency key. */
  "dispatching",
  /** The runtime has the work. */
  "running",
  /** The agent paused on a gated tool call and needs the user's decision (Hermes). */
  "awaiting_approval",
  /** Reserved: no runtime surfaces mid-run questions today. */
  "awaiting_input",
  /** Stop requested; the runtime has not settled yet. */
  "cancelling",
  /** An output version is ready. */
  "awaiting_review",
  /** The user approved the output. */
  "completed",
  /** The user rejected the task. */
  "rejected",
  /** Ended without an output; `last_error` is the safe reason. */
  "failed",
  /** Stopped deliberately. */
  "cancelled",
] as const;

export type TaskState = (typeof TASK_STATES)[number];

export function isTaskState(value: unknown): value is TaskState {
  return typeof value === "string" && (TASK_STATES as readonly string[]).includes(value);
}

/** Legacy `agent_tasks.status` values, kept by the CHECK constraint. */
export type CoarseStatus =
  | "queued"
  | "processing"
  | "awaiting_review"
  | "revision_requested"
  | "approved"
  | "rejected"
  | "failed";

/** States in which the runtime may be doing work right now. */
export const ACTIVE_STATES: readonly TaskState[] = [
  "dispatching",
  "running",
  "awaiting_approval",
  "awaiting_input",
  "cancelling",
];

/** States the reconciler polls an asynchronous runtime (Hermes) for. */
export const POLLED_STATES: readonly TaskState[] = [
  "running",
  "awaiting_approval",
  "awaiting_input",
  "cancelling",
];

/** States from which the user can send (or re-send) the task. */
export const SENDABLE_STATES: readonly TaskState[] = [
  "needs_dispatch",
  "needs_review",
  "failed",
  "cancelled",
];

/** States that can be cancelled without asking the runtime, because it never had them. */
export const LOCALLY_CANCELLABLE_STATES: readonly TaskState[] = [
  "needs_dispatch",
  "needs_review",
  "queued",
];

/** States where cancelling means asking the runtime to stop. */
export const REMOTELY_CANCELLABLE_STATES: readonly TaskState[] = [
  "running",
  "awaiting_approval",
  "awaiting_input",
];

export function isActive(state: TaskState | null | undefined): boolean {
  return !!state && ACTIVE_STATES.includes(state);
}

/**
 * The coarse `agent_tasks.status` for a precise state.
 *
 * Where a task already has an output version, a failed or cancelled *revision*
 * leaves that earlier version reviewable rather than reporting the whole task
 * as failed: the work the user already has did not stop existing.
 */
export function coarseStatus(state: TaskState, currentVersion: number): CoarseStatus {
  const hasOutput = currentVersion > 0;
  switch (state) {
    case "needs_dispatch":
    case "queued":
      return hasOutput ? "revision_requested" : "queued";
    case "dispatching":
    case "running":
    case "awaiting_approval":
    case "awaiting_input":
    case "cancelling":
      return "processing";
    case "awaiting_review":
      return "awaiting_review";
    case "completed":
      return "approved";
    case "rejected":
      return "rejected";
    case "needs_review":
    case "failed":
      return hasOutput ? "awaiting_review" : "failed";
    case "cancelled":
      return hasOutput ? "awaiting_review" : "rejected";
  }
}

// ── Hermes run status ────────────────────────────────────────────────────────

/** Statuses `GET /v1/runs/{id}` reports (Hermes `api_server_runs.py`). */
export type HermesRunStatus =
  | "queued"
  | "running"
  | "waiting_for_approval"
  | "stopping"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export type RunOutcome =
  | { kind: "in_progress"; state: TaskState }
  | { kind: "completed"; output: string }
  | { kind: "failed"; reason: string; runState: "failed" | "interrupted" }
  | { kind: "cancelled" }
  | { kind: "unknown"; status: string };

/**
 * What a polled Hermes run status means for the task.
 *
 * `completed` with no visible text is a failure, not a blank deliverable:
 * storing an empty version would put "nothing" in front of the user as if it
 * were the agent's answer.
 */
export function interpretRunStatus(
  status: string | null | undefined,
  output: unknown,
  error: unknown
): RunOutcome {
  switch (status) {
    case "queued":
    case "running":
      return { kind: "in_progress", state: "running" };
    case "waiting_for_approval":
      return { kind: "in_progress", state: "awaiting_approval" };
    case "stopping":
      return { kind: "in_progress", state: "cancelling" };
    case "completed": {
      const text = typeof output === "string" ? output.trim() : "";
      if (!text) {
        return {
          kind: "failed",
          runState: "failed",
          reason: "The agent finished the run but returned no visible answer.",
        };
      }
      return { kind: "completed", output: text };
    }
    case "failed":
      return {
        kind: "failed",
        runState: "failed",
        reason: describeRunFailure(error),
      };
    case "interrupted":
      return {
        kind: "failed",
        runState: "interrupted",
        reason:
          "The agent's Hermes gateway shut down while this was running, so the run was interrupted. " +
          "It may have done part of the work. Check before retrying.",
      };
    case "cancelled":
      return { kind: "cancelled" };
    default:
      return { kind: "unknown", status: String(status ?? "") };
  }
}

function describeRunFailure(error: unknown): string {
  const raw = typeof error === "string" ? error : "";
  if (/max_iterations|iteration budget/i.test(raw)) {
    return "The agent ran out of steps before finishing. Narrow the instruction or retry.";
  }
  if (/partial|truncat/i.test(raw)) {
    return "The agent stopped before finishing its answer. Retry, or narrow the instruction.";
  }
  return "The agent reported that the run failed. Retry, or open the task's Hermes session to see what happened.";
}

// ── Approvals (Hermes) ───────────────────────────────────────────────────────

/**
 * The only choices Brain Portal ever sends. Hermes also accepts `session` and
 * `always`, which widen the agent's standing permissions; that is a decision to
 * make in Hermes itself, never as a side effect of reviewing one task.
 */
export const APPROVAL_CHOICES = ["once", "deny"] as const;
export type ApprovalChoice = (typeof APPROVAL_CHOICES)[number];

export function isApprovalChoice(value: unknown): value is ApprovalChoice {
  return typeof value === "string" && (APPROVAL_CHOICES as readonly string[]).includes(value);
}

/** What Brain Portal stores and shows about a pending approval. Nothing else. */
export interface PendingApproval {
  requestId: string | null;
  /** The tool or command the agent wants to run, as Hermes redacted it. */
  command: string | null;
  description: string | null;
  tool: string | null;
}

const MAX_APPROVAL_COMMAND = 1000;
const MAX_APPROVAL_DESCRIPTION = 600;

function clip(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

/**
 * Reduce Hermes's approval event to an allowlist of display fields.
 *
 * Hermes already redacts secrets in `command`; `redact` runs on top of that
 * because a second, independent pass is cheap and the UI is the one place this
 * text leaves the server. Arbitrary tool arguments are never copied through.
 */
export function parsePendingApproval(
  raw: unknown,
  redact: (text: string) => string = (t) => t
): PendingApproval | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const requestId = clip(r.request_id, 256);
  const command = clip(r.command, MAX_APPROVAL_COMMAND);
  const description = clip(r.description, MAX_APPROVAL_DESCRIPTION);
  const tool = clip(r.tool_name ?? r.tool, 120);
  if (!requestId && !command && !description && !tool) return null;
  return {
    requestId,
    command: command ? redact(command) : null,
    description: description ? redact(description) : null,
    tool,
  };
}

/**
 * Redaction for text that came from a runtime and is about to be shown or stored.
 *
 * On top of the shared provider-key patterns: anything shaped like a secret
 * flag or assignment (`--token x`, `password=x`, `"api_key": "x"`), and the
 * literal secrets Brain Portal itself holds for the runtime, which are the ones
 * most likely to turn up in a command an agent wants to run against its own setup.
 */
export function redactAgentText(text: string, knownSecrets: readonly string[] = []): string {
  let out = text;
  for (const secret of knownSecrets) {
    if (secret && secret.length >= 8) out = out.split(secret).join("[redacted]");
  }
  return out
    .replace(
      /(--?(?:token|password|passwd|secret|api[-_]?key|auth|key)(?:=|\s+))("[^"]*"|'[^']*'|\S+)/gi,
      "$1[redacted]"
    )
    .replace(
      /(["']?\b(?:token|password|passwd|secret|api[-_]?key|access[-_]?key|client[-_]?secret)\b["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;}&]+)/gi,
      "$1[redacted]"
    );
}

// ── Display ──────────────────────────────────────────────────────────────────

/** Labels that read correctly whatever the operator named their agent. */
export const TASK_STATE_LABELS: Record<TaskState, string> = {
  needs_dispatch: "Not sent",
  needs_review: "Needs your review",
  queued: "Queued",
  dispatching: "Sending",
  running: "Working",
  awaiting_approval: "Waiting for your approval",
  awaiting_input: "Waiting for your input",
  cancelling: "Stopping",
  awaiting_review: "Ready for review",
  completed: "Completed",
  rejected: "Rejected",
  failed: "Failed",
  cancelled: "Cancelled",
};

/** Hermes session id for a task: one conversation per task, so a revision is the next turn. */
export function sessionIdForTask(agentTaskId: string): string {
  return `brain-portal-task-${agentTaskId}`;
}
