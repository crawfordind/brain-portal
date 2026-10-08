/**
 * Jack task lifecycle: the vocabulary and the pure rules over it.
 *
 * Imports nothing, for the same reason `chat/item-types.ts` and
 * `provenance/types.ts` don't: the browser, the route handlers, the cron and
 * the tests all share it, and none of them may drag in a DB client.
 *
 * `agent_tasks.status` carries a CHECK constraint that predates Jack, and
 * widening it means rebuilding a table two others cascade from. So the precise
 * state lives in `agent_tasks.jack_state`, and `status` stays the coarse
 * projection every existing reader already understands. `coarseStatus` is the
 * only place that projection is decided.
 */

export const JACK_STATES = [
  /** Accepted and deliberately not sent: Jack is off, or migrated legacy work. */
  "needs_dispatch",
  /** Could not be mapped to a Jack task safely; `last_error` says why. */
  "needs_review",
  /** Accepted by Brain Portal, not yet handed to Jack. */
  "queued",
  /** Submit in flight, or being retried with the same idempotency key. */
  "dispatching",
  /** Jack has the run. */
  "running",
  /** Jack paused on a gated tool call and needs Daniel's decision. */
  "awaiting_approval",
  /** Reserved: the Hermes Runs API surfaces approvals only, not questions. */
  "awaiting_input",
  /** Stop requested; Jack has not settled yet. */
  "cancelling",
  /** An output version is ready. */
  "awaiting_review",
  /** Daniel approved the output. */
  "completed",
  /** Daniel rejected the task. */
  "rejected",
  /** Ended without an output; `last_error` is the safe reason. */
  "failed",
  /** Stopped deliberately. */
  "cancelled",
] as const;

export type JackState = (typeof JACK_STATES)[number];

export function isJackState(value: unknown): value is JackState {
  return typeof value === "string" && (JACK_STATES as readonly string[]).includes(value);
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

/** States in which Jack may be doing work right now. */
export const ACTIVE_STATES: readonly JackState[] = [
  "dispatching",
  "running",
  "awaiting_approval",
  "awaiting_input",
  "cancelling",
];

/** States the reconciler polls Hermes for. */
export const POLLED_STATES: readonly JackState[] = [
  "running",
  "awaiting_approval",
  "awaiting_input",
  "cancelling",
];

/** States from which Daniel can send (or re-send) the task to Jack. */
export const SENDABLE_STATES: readonly JackState[] = [
  "needs_dispatch",
  "needs_review",
  "failed",
  "cancelled",
];

/** States that can be cancelled without asking Jack, because Jack never had them. */
export const LOCALLY_CANCELLABLE_STATES: readonly JackState[] = [
  "needs_dispatch",
  "needs_review",
  "queued",
];

/** States where cancelling means asking Jack to stop. */
export const REMOTELY_CANCELLABLE_STATES: readonly JackState[] = [
  "running",
  "awaiting_approval",
  "awaiting_input",
];

export function isActive(state: JackState | null | undefined): boolean {
  return !!state && ACTIVE_STATES.includes(state);
}

/**
 * The coarse `agent_tasks.status` for a Jack state.
 *
 * Where a task already has an output version, a failed or cancelled *revision*
 * leaves that earlier version reviewable rather than reporting the whole task
 * as failed: the work Daniel already has did not stop existing.
 */
export function coarseStatus(state: JackState, currentVersion: number): CoarseStatus {
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
  | { kind: "in_progress"; state: JackState }
  | { kind: "completed"; output: string }
  | { kind: "failed"; reason: string; runState: "failed" | "interrupted" }
  | { kind: "cancelled" }
  | { kind: "unknown"; status: string };

/**
 * What a polled Hermes run status means for the task.
 *
 * `completed` with no visible text is a failure, not a blank deliverable:
 * storing an empty version would put "nothing" in front of Daniel as if it
 * were Jack's answer.
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
          reason: "Jack finished the run but returned no visible answer.",
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
          "Jack's gateway shut down while this was running, so the run was interrupted. " +
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
    return "Jack ran out of steps before finishing. Narrow the instruction or retry.";
  }
  if (/partial|truncat/i.test(raw)) {
    return "Jack stopped before finishing its answer. Retry, or narrow the instruction.";
  }
  return "Jack reported that the run failed. Retry, or open Jack's session to see what happened.";
}

// ── Approvals ────────────────────────────────────────────────────────────────

/**
 * The only choices Brain Portal ever sends. Hermes also accepts `session` and
 * `always`, which widen Jack's standing permissions; that is a decision to make
 * in Hermes itself, never as a side effect of reviewing one task.
 */
export const APPROVAL_CHOICES = ["once", "deny"] as const;
export type ApprovalChoice = (typeof APPROVAL_CHOICES)[number];

export function isApprovalChoice(value: unknown): value is ApprovalChoice {
  return typeof value === "string" && (APPROVAL_CHOICES as readonly string[]).includes(value);
}

/** What Brain Portal stores and shows about a pending approval. Nothing else. */
export interface PendingApproval {
  requestId: string | null;
  /** The tool or command Jack wants to run, as Hermes redacted it. */
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
 * Redaction for text that came from Jack and is about to be shown or stored.
 *
 * On top of the shared provider-key patterns: anything shaped like a secret
 * flag or assignment (`--token x`, `password=x`, `"api_key": "x"`), and the
 * literal secrets Brain Portal itself holds for Jack, which are the ones most
 * likely to turn up in a command Jack wants to run against its own setup.
 */
export function redactJackText(text: string, knownSecrets: readonly string[] = []): string {
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

export const JACK_STATE_LABELS: Record<JackState, string> = {
  needs_dispatch: "Not sent",
  needs_review: "Needs your review",
  queued: "Queued for Jack",
  dispatching: "Sending to Jack",
  running: "Jack is working",
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
