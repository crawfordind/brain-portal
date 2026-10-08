/**
 * Jack dispatcher: the only code that moves a delegated task through its
 * lifecycle, and the only code that talks to Jack.
 *
 * Brain Portal owns the records; Jack executes. Every network call is made
 * against state that was durably recorded first, so a crash at any point
 * leaves something the next reconcile pass can finish honestly:
 *
 *   queued ─claim─▶ dispatching ─POST /v1/runs─▶ running ─poll─▶ awaiting_review
 *                        │ (same key, same bytes, bounded)      ├─▶ awaiting_approval ⇄ running
 *                        └─▶ failed                             ├─▶ failed / cancelled
 *                                                               └─▶ (cancel) cancelling ─▶ cancelled
 *
 * There is no OpenRouter anywhere in this file, and no fallback to it.
 */

import { randomUUID } from "node:crypto";
import { db, queryAll, queryOne } from "@/lib/db/client";
import type { AgentTask, AgentTaskOutput } from "@/lib/db/schema";
import { getCompiledGuardrails } from "@/lib/guardrails";
import { buildAnnotationPromptSection } from "@/lib/annotations";
import { redactSecrets } from "@/lib/system-health/diagnose";
import { syncTaskStatusFromAgentTask } from "../status-sync";
import { getJackConfig, type JackConfig } from "./config";
import { createJackClient, JackError, type JackClient, type HermesRun } from "./client";
import { buildEnvelope, type EnvelopeInput, type EnvelopeSourceType } from "./envelope";
import {
  coarseStatus,
  interpretRunStatus,
  isJackState,
  parsePendingApproval,
  redactJackText,
  sessionIdForTask,
  LOCALLY_CANCELLABLE_STATES,
  POLLED_STATES,
  REMOTELY_CANCELLABLE_STATES,
  SENDABLE_STATES,
  type ApprovalChoice,
  type JackState,
  type PendingApproval,
} from "./types";

// ── Dependencies ─────────────────────────────────────────────────────────────

export interface JackDeps {
  config?: JackConfig;
  /** Injected in tests; built from `config` otherwise. */
  client?: JackClient;
  /** Per-request timeout for Hermes calls. UI-triggered polls pass a short one. */
  timeoutMs?: number;
}

function connect(deps: JackDeps = {}): { config: JackConfig; client: JackClient | null } {
  const config = deps.config ?? getJackConfig();
  if (config.state !== "ready") return { config, client: null };
  return { config, client: deps.client ?? createJackClient(config, { timeoutMs: deps.timeoutMs }) };
}

/** Automatic submit retries, only for outcomes where Hermes deduplicates by key. */
export const MAX_DISPATCH_ATTEMPTS = 6;
/** Hermes keeps idempotency keys for 24h; re-using one later could start a second run. */
const IDEMPOTENCY_REUSE_HOURS = 23;

// ── Row shapes ───────────────────────────────────────────────────────────────

export type JackTaskRow = AgentTask & {
  runtime: string | null;
  jack_state: string | null;
  jack_session_id: string | null;
};

export interface RunRow {
  id: string;
  agent_task_id: string;
  user_id: string;
  kind: "initial" | "revision" | "retry";
  idempotency_key: string;
  request_body: string;
  state: string;
  hermes_run_id: string | null;
  hermes_session_id: string | null;
  dispatch_attempts: number;
  last_dispatch_error: string | null;
  approval: string | null;
  runtime_model: string | null;
  output_version: number | null;
  error: string | null;
  unreachable_since: string | null;
  created_at: string;
  updated_at: string;
  last_polled_at: string | null;
  finished_at: string | null;
}

export async function getTaskForUser(taskId: string, userId: string): Promise<JackTaskRow | null> {
  return queryOne<JackTaskRow>("SELECT * FROM agent_tasks WHERE id = ? AND user_id = ?", [taskId, userId]);
}

async function getTask(taskId: string): Promise<JackTaskRow | null> {
  return queryOne<JackTaskRow>("SELECT * FROM agent_tasks WHERE id = ?", [taskId]);
}

export async function latestRun(taskId: string): Promise<RunRow | null> {
  return queryOne<RunRow>(
    "SELECT * FROM agent_task_runs WHERE agent_task_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
    [taskId]
  );
}

function stateOf(task: Pick<JackTaskRow, "jack_state">): JackState | null {
  return isJackState(task.jack_state) ? task.jack_state : null;
}

// ── Audit trail ──────────────────────────────────────────────────────────────

export type EventActor = "user" | "jack" | "system";

export async function recordEvent(
  taskId: string,
  userId: string,
  actor: EventActor,
  kind: string,
  detail: Record<string, unknown> | null = null,
  runId: string | null = null
): Promise<void> {
  try {
    await db.execute({
      sql: `INSERT INTO agent_task_events (agent_task_id, user_id, run_id, actor, kind, detail)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [taskId, userId, runId, actor, kind, detail ? JSON.stringify(detail) : null],
    });
  } catch (error) {
    // The audit row must not take down the transition it describes.
    console.error(`[Jack] could not record ${kind} for ${taskId}:`, error instanceof Error ? error.message : error);
  }
}

// ── State transitions ────────────────────────────────────────────────────────

/**
 * Conditionally move a task between Jack states, keeping the coarse status and
 * the linked task row in step. Returns false when the task was not in one of
 * `from` — someone else got there first, which callers treat as "stand down".
 */
export async function transition(
  taskId: string,
  from: readonly JackState[],
  to: JackState,
  options: { lastError?: string | null } = {}
): Promise<boolean> {
  const withOutput = coarseStatus(to, 1);
  const withoutOutput = coarseStatus(to, 0);
  const setError = options.lastError !== undefined;
  const result = await db.execute({
    sql: `UPDATE agent_tasks
          SET jack_state = ?,
              status = CASE WHEN COALESCE(current_version, 0) > 0 THEN ? ELSE ? END,
              ${setError ? "last_error = ?," : ""}
              updated_at = datetime('now')
          WHERE id = ? AND runtime = 'jack' AND jack_state IN (${from.map(() => "?").join(", ")})`,
    args: [
      to,
      withOutput,
      withoutOutput,
      ...(setError ? [options.lastError ?? null] : []),
      taskId,
      ...from,
    ],
  });
  if ((result?.rowsAffected ?? 0) === 0) return false;
  await syncCoarse(taskId);
  return true;
}

async function syncCoarse(taskId: string): Promise<void> {
  try {
    const row = await queryOne<{ status: string }>("SELECT status FROM agent_tasks WHERE id = ?", [taskId]);
    if (row) await syncTaskStatusFromAgentTask(taskId, row.status);
  } catch (error) {
    console.error(`[Jack] status sync failed for ${taskId}:`, error instanceof Error ? error.message : error);
  }
}

async function setTaskNote(taskId: string, message: string | null): Promise<void> {
  await db.execute({
    sql: "UPDATE agent_tasks SET last_error = ?, updated_at = datetime('now') WHERE id = ?",
    args: [message, taskId],
  });
}

// ── Adoption ─────────────────────────────────────────────────────────────────

/**
 * Take ownership of rows written by paths that do not know about Jack: the MCP
 * server (its own libsql client, outside Next.js), heartbeat and skills insert
 * `status = 'queued'` with `runtime` NULL. Before this, the cron executed those
 * through OpenRouter. Now they become Jack tasks, or wait if Jack is off.
 *
 * Only `queued` rows: the migration parked every legacy row in another state,
 * so a `queued` row with no runtime is new work by construction.
 */
export async function adoptNewTasks(config: JackConfig, taskId?: string): Promise<number> {
  const ready = config.state === "ready";
  const result = await db.execute({
    sql: `UPDATE agent_tasks
          SET runtime = 'jack',
              jack_state = ?,
              jack_session_id = COALESCE(jack_session_id, 'brain-portal-task-' || id),
              last_error = ?,
              updated_at = datetime('now')
          WHERE runtime IS NULL AND status = 'queued' ${taskId ? "AND id = ?" : ""}`,
    args: [
      ready ? "queued" : "needs_dispatch",
      ready ? null : config.reason,
      ...(taskId ? [taskId] : []),
    ],
  });
  return result?.rowsAffected ?? 0;
}

/** For callers that just inserted a row (skills): adopt it and send it now if possible. */
export async function adoptAndDispatch(taskId: string, deps: JackDeps = {}): Promise<DispatchOutcome> {
  const { config } = connect(deps);
  await adoptNewTasks(config, taskId);
  return dispatchJackTask(taskId, deps);
}

// ── Creating ─────────────────────────────────────────────────────────────────

export interface CreateJackTaskInput {
  userId: string;
  title: string;
  description: string;
  taskType: string;
  assignedAgent: string;
  priority: string;
  outputFormat: string;
  contextNoteIds: string[];
  contextUrls: string[];
  projectId: string | null;
  sourceType: string;
  sourceId: string | null;
  /** Links the source `tasks` row so its status follows the delegation, as before. */
  linkTaskId: string | null;
  routedBy?: string;
}

export async function createJackTask(
  input: CreateJackTaskInput,
  deps: JackDeps = {}
): Promise<{ task: JackTaskRow; outcome: DispatchOutcome }> {
  const { config } = connect(deps);
  const ready = config.state === "ready";
  const id = randomUUID().replace(/-/g, "");

  await db.execute({
    sql: `INSERT INTO agent_tasks
            (id, user_id, task_id, title, description, task_type, assigned_agent, priority,
             output_format, context_note_ids, context_urls, project_id, source_type, source_id,
             routed_by, status, runtime, jack_state, jack_session_id, last_error)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 'jack', ?, ?, ?)`,
    args: [
      id,
      input.userId,
      input.linkTaskId,
      input.title,
      input.description,
      input.taskType,
      input.assignedAgent,
      input.priority,
      input.outputFormat,
      JSON.stringify(input.contextNoteIds),
      JSON.stringify(input.contextUrls),
      input.projectId,
      input.sourceType,
      input.sourceId,
      input.routedBy ?? "user",
      ready ? "queued" : "needs_dispatch",
      sessionIdForTask(id),
      ready ? null : config.reason,
    ],
  });

  if (input.linkTaskId) {
    // Only claim a task that is not already linked to other delegated work.
    await db.execute({
      sql: `UPDATE tasks SET agent_task_id = ?, updated_at = datetime('now')
            WHERE id = ? AND user_id = ? AND agent_task_id IS NULL`,
      args: [id, input.linkTaskId, input.userId],
    });
  }

  await recordEvent(id, input.userId, input.routedBy === "user" || !input.routedBy ? "user" : "system", "created", {
    source_type: input.sourceType,
    source_id: input.sourceId,
    jack_available: ready,
  });

  const outcome = ready ? await dispatchJackTask(id, deps) : "not_configured";
  const task = (await getTask(id))!;
  return { task, outcome };
}

// ── Dispatch ─────────────────────────────────────────────────────────────────

export type DispatchOutcome =
  | "dispatched"
  | "retrying"
  | "failed"
  | "not_claimed"
  | "not_configured";

/**
 * Hand a `queued` task to Jack. Safe to call from anywhere, any number of
 * times: the conditional claim lets exactly one caller proceed.
 */
export async function dispatchJackTask(taskId: string, deps: JackDeps = {}): Promise<DispatchOutcome> {
  const { config, client } = connect(deps);

  if (!client) {
    await transition(taskId, ["queued"], "needs_dispatch", { lastError: config.reason });
    return "not_configured";
  }

  const claim = await db.execute({
    sql: `UPDATE agent_tasks
          SET jack_state = 'dispatching', status = 'processing', updated_at = datetime('now')
          WHERE id = ? AND runtime = 'jack' AND jack_state = 'queued'`,
    args: [taskId],
  });
  if ((claim?.rowsAffected ?? 0) === 0) return "not_claimed";
  await syncCoarse(taskId);

  const task = await getTask(taskId);
  if (!task) return "not_claimed";

  let run: RunRow;
  try {
    const envelopeInput = await loadEnvelopeInput(task);
    const envelope = buildEnvelope(envelopeInput);
    const sessionId = task.jack_session_id || sessionIdForTask(task.id);
    const body = { input: envelope.input, instructions: envelope.instructions, session_id: sessionId };
    const runId = randomUUID().replace(/-/g, "");
    const kind = envelopeInput.revision ? "revision" : (await latestRun(taskId)) ? "retry" : "initial";

    // Recorded before the POST, so a crash after Hermes accepted the run is
    // recovered by replaying these exact bytes under this exact key.
    await db.execute({
      sql: `INSERT INTO agent_task_runs
              (id, agent_task_id, user_id, kind, idempotency_key, request_body, state, hermes_session_id)
            VALUES (?, ?, ?, ?, ?, ?, 'dispatching', ?)`,
      args: [runId, taskId, task.user_id, kind, `brain-portal:${runId}:${randomUUID()}`, JSON.stringify(body), sessionId],
    });
    run = (await queryOne<RunRow>("SELECT * FROM agent_task_runs WHERE id = ?", [runId]))!;
  } catch (error) {
    console.error(`[Jack] could not prepare ${taskId}:`, error instanceof Error ? error.message : error);
    await transition(taskId, ["dispatching"], "failed", {
      lastError: "Brain Portal could not assemble this task's context, so nothing was sent to Jack. Retry, and report it if it repeats.",
    });
    await recordEvent(taskId, task.user_id, "system", "failed", { stage: "prepare" });
    return "failed";
  }

  return submitRun(task, run, client);
}

async function submitRun(task: JackTaskRow, run: RunRow, client: JackClient): Promise<DispatchOutcome> {
  const attempts = (run.dispatch_attempts ?? 0) + 1;
  try {
    const { runId: hermesRunId, replayed } = await client.createRun(JSON.parse(run.request_body), run.idempotency_key);
    await db.batch(
      [
        {
          sql: `UPDATE agent_task_runs
                SET state = 'running', hermes_run_id = ?, dispatch_attempts = ?, last_dispatch_error = NULL,
                    unreachable_since = NULL, updated_at = datetime('now')
                WHERE id = ? AND state = 'dispatching'`,
          args: [hermesRunId, attempts, run.id],
        },
        {
          sql: `UPDATE agent_tasks
                SET jack_state = 'running', status = 'processing', last_error = NULL, updated_at = datetime('now')
                WHERE id = ? AND jack_state = 'dispatching'`,
          args: [task.id],
        },
      ],
      "write"
    );
    await syncCoarse(task.id);
    await recordEvent(task.id, task.user_id, "jack", "dispatched", { hermes_run_id: hermesRunId, replayed }, run.id);
    return "dispatched";
  } catch (error) {
    const err = error instanceof JackError ? error : new JackError("unreachable", "Jack could not be reached.");

    if (err.retryable && attempts < MAX_DISPATCH_ATTEMPTS) {
      await db.execute({
        sql: `UPDATE agent_task_runs
              SET dispatch_attempts = ?, last_dispatch_error = ?, updated_at = datetime('now')
              WHERE id = ?`,
        args: [attempts, err.message, run.id],
      });
      await setTaskNote(task.id, `Sending to Jack: ${err.message} Retrying automatically (attempt ${attempts} of ${MAX_DISPATCH_ATTEMPTS}).`);
      return "retrying";
    }

    // Retryable but out of budget: the request may still have landed, so the
    // run row keeps its key ("abandoned", not "failed") for an explicit Retry.
    const runState = err.retryable ? "abandoned" : "failed";
    const message = err.retryable
      ? `Jack could not be reached after ${attempts} attempts (${err.message}) Retry re-sends the same request; if Jack did receive it, Jack continues that run instead of starting a second one.`
      : err.message;
    await db.execute({
      sql: `UPDATE agent_task_runs
            SET state = ?, dispatch_attempts = ?, last_dispatch_error = ?, error = ?, finished_at = datetime('now'),
                updated_at = datetime('now')
            WHERE id = ?`,
      args: [runState, attempts, err.message, err.message, run.id],
    });
    await transition(task.id, ["dispatching"], "failed", { lastError: message });
    await recordEvent(task.id, task.user_id, "system", "failed", { stage: "dispatch", kind: err.kind }, run.id);
    return "failed";
  }
}

// ── Context loading ──────────────────────────────────────────────────────────

const ENVELOPE_SOURCE_TYPES = new Set<EnvelopeSourceType>([
  "task", "note", "capture", "thought", "reminder", "insight", "journal", "project", "contact",
]);

function parseJsonArray(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/** Every read is scoped to the task's owner; nothing reaches Jack that the owner does not own. */
export async function loadEnvelopeInput(task: JackTaskRow): Promise<EnvelopeInput> {
  const userId = task.user_id;
  const sourceType = (ENVELOPE_SOURCE_TYPES.has(task.source_type as EnvelopeSourceType)
    ? task.source_type
    : "task") as EnvelopeSourceType;
  const sourceId = task.source_id || task.task_id || null;

  let sourceContent: string | null = null;
  let annotations = "";
  if (sourceId) {
    sourceContent = await loadSourceContent(userId, sourceType, sourceId);
    if (sourceType === "note") {
      const note = await queryOne<{ content: string | null }>(
        "SELECT content FROM notes WHERE id = ? AND user_id = ?",
        [sourceId, userId]
      );
      annotations = buildAnnotationPromptSection(note?.content);
    }
  }
  if (sourceContent && sourceContent.trim() === task.description.trim()) sourceContent = null;

  const noteIds = parseJsonArray(task.context_note_ids).slice(0, 5);
  const attachedNotes = noteIds.length
    ? (await queryAll<{ id: string; title: string; content_plain: string | null; content: string | null }>(
        `SELECT id, title, content_plain, content FROM notes
         WHERE user_id = ? AND id IN (${noteIds.map(() => "?").join(", ")})`,
        [userId, ...noteIds]
      )).map((n) => ({ id: n.id, title: n.title, content: n.content_plain || n.content || "" }))
    : [];

  const project = task.project_id
    ? await queryOne<{ id: string; name: string; description: string | null }>(
        "SELECT id, name, description FROM projects WHERE id = ? AND user_id = ?",
        [task.project_id, userId]
      )
    : null;

  let guardrails = "";
  try {
    guardrails = (await getCompiledGuardrails(userId)) || "";
  } catch {
    // Optional table.
  }

  let revision: EnvelopeInput["revision"] = null;
  if ((task.current_version ?? 0) > 0) {
    const previous = await queryOne<AgentTaskOutput>(
      "SELECT * FROM agent_task_outputs WHERE agent_task_id = ? ORDER BY version_number DESC LIMIT 1",
      [task.id]
    );
    const feedback = await queryOne<{ feedback_text: string | null }>(
      `SELECT feedback_text FROM agent_task_feedback
       WHERE agent_task_id = ? AND feedback_type = 'request_edit'
       ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      [task.id]
    );
    if (previous) {
      revision = {
        previousVersion: previous.version_number,
        previousOutput: previous.content,
        feedback: feedback?.feedback_text || "Please try again.",
      };
    }
  }

  return {
    agentTaskId: task.id,
    title: task.title,
    instruction: task.description,
    source: { type: sourceType, id: sourceId, content: sourceContent },
    attachedNotes,
    annotations,
    project,
    urls: parseJsonArray(task.context_urls),
    guardrails,
    outputFormat: task.output_format || "markdown",
    revision,
  };
}

async function loadSourceContent(userId: string, type: EnvelopeSourceType, id: string): Promise<string | null> {
  try {
    switch (type) {
      case "note":
      case "journal": {
        const r = await queryOne<{ title: string; content_plain: string | null; content: string | null }>(
          "SELECT title, content_plain, content FROM notes WHERE id = ? AND user_id = ?",
          [id, userId]
        );
        return r ? `${r.title}\n\n${r.content_plain || r.content || ""}` : null;
      }
      case "task": {
        const r = await queryOne<{ title: string | null; description: string | null; content: string | null; status: string | null; due_date: string | null }>(
          "SELECT title, description, content, status, due_date FROM tasks WHERE id = ? AND user_id = ?",
          [id, userId]
        );
        if (!r) return null;
        return [
          r.title || r.content,
          r.description && r.description !== r.title ? r.description : null,
          r.status ? `Status: ${r.status}` : null,
          r.due_date ? `Due: ${r.due_date}` : null,
        ].filter(Boolean).join("\n");
      }
      case "capture":
      case "thought": {
        const r = await queryOne<{ content: string }>("SELECT content FROM captures WHERE id = ? AND user_id = ?", [id, userId]);
        return r?.content ?? null;
      }
      case "reminder": {
        const r = await queryOne<{ title: string | null; content: string | null }>(
          "SELECT title, content FROM reminders WHERE id = ? AND user_id = ?",
          [id, userId]
        );
        return r ? [r.title, r.content].filter(Boolean).join("\n\n") : null;
      }
      case "insight": {
        const r = await queryOne<{ content: string }>("SELECT content FROM insights WHERE id = ? AND user_id = ?", [id, userId]);
        return r?.content ?? null;
      }
      case "project": {
        const r = await queryOne<{ name: string; description: string | null; status: string | null }>(
          "SELECT name, description, status FROM projects WHERE id = ? AND user_id = ?",
          [id, userId]
        );
        return r ? [r.name, r.description, r.status ? `Status: ${r.status}` : null].filter(Boolean).join("\n") : null;
      }
      case "contact": {
        // Name and type only. Channels and history are personal data Jack can
        // fetch over MCP (`get_contact_brief`) when the task actually needs them.
        const r = await queryOne<{ canonical_name: string; entity_type: string }>(
          "SELECT canonical_name, entity_type FROM entities WHERE id = ? AND user_id = ?",
          [id, userId]
        );
        return r ? `${r.canonical_name} (${r.entity_type})` : null;
      }
    }
  } catch {
    return null;
  }
  return null;
}

// ── Polling ──────────────────────────────────────────────────────────────────

export type ReconcileOutcome =
  | "skipped"
  | "unchanged"
  | "updated"
  | "completed"
  | "failed"
  | "cancelled"
  | "unreachable";

function parseDbTime(value: string | null | undefined): number {
  if (!value) return 0;
  const iso = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

/**
 * Bring one task's state in line with what Jack reports. Idempotent; any
 * number of concurrent callers converge on one output version.
 */
export async function reconcileJackTask(
  taskId: string,
  deps: JackDeps = {},
  options: { minIntervalMs?: number } = {}
): Promise<ReconcileOutcome> {
  const { client, config } = connect(deps);
  if (!client) return "skipped";
  const secrets = [config.apiKey, ...Object.values(config.edgeHeaders)];
  const redact = (text: string) => redactSecrets(redactJackText(text, secrets));

  const task = await getTask(taskId);
  const state = task ? stateOf(task) : null;
  if (!task || !state || !POLLED_STATES.includes(state)) return "skipped";

  const run = await queryOne<RunRow>(
    `SELECT * FROM agent_task_runs WHERE agent_task_id = ? AND hermes_run_id IS NOT NULL
     ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    [taskId]
  );
  if (!run?.hermes_run_id) return "skipped";

  if (options.minIntervalMs && Date.now() - parseDbTime(run.last_polled_at) < options.minIntervalMs) {
    return "skipped";
  }

  let remote: HermesRun;
  try {
    remote = await client.getRun(run.hermes_run_id);
  } catch (error) {
    const err = error instanceof JackError ? error : new JackError("unreachable", "Jack could not be reached.");
    if (err.kind === "not_found") {
      await db.execute({
        sql: `UPDATE agent_task_runs SET state = 'lost', error = ?, finished_at = datetime('now'),
                last_polled_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
        args: [err.message, run.id],
      });
      await transition(taskId, POLLED_STATES, "failed", {
        lastError: `Jack no longer has a record of this run, so its result could not be collected. Open Jack's session "${run.hermes_session_id ?? sessionIdForTask(taskId)}" to see what happened, or retry.`,
      });
      await recordEvent(taskId, task.user_id, "system", "failed", { stage: "poll", kind: "lost" }, run.id);
      return "failed";
    }
    // Unreachable is not failure. Leave the state alone and say how long it has been.
    await db.execute({
      sql: `UPDATE agent_task_runs
            SET unreachable_since = COALESCE(unreachable_since, datetime('now')), last_polled_at = datetime('now')
            WHERE id = ?`,
      args: [run.id],
    });
    const since = run.unreachable_since ?? new Date().toISOString().slice(0, 19).replace("T", " ");
    await setTaskNote(
      taskId,
      err.kind === "auth"
        ? err.message
        : `Jack unreachable since ${since} UTC; this task's status is unknown until Jack answers. Still checking. (${err.message})`
    );
    return "unreachable";
  }

  const wasUnreachable = !!run.unreachable_since;
  const outcome = interpretRunStatus(remote.status, remote.output, remote.error);

  switch (outcome.kind) {
    case "in_progress": {
      // A stop request stays "stopping" in Brain Portal until Jack settles it.
      const target: JackState = state === "cancelling" ? "cancelling" : outcome.state;
      const runState = target === "awaiting_approval" ? "awaiting_approval" : target === "cancelling" ? "stopping" : "running";
      const approval = target === "awaiting_approval" ? parsePendingApproval(remote.approval, redact) : null;
      const previous = parseStoredApproval(run.approval);

      await db.execute({
        sql: `UPDATE agent_task_runs
              SET state = ?, approval = ?, unreachable_since = NULL, last_polled_at = datetime('now'),
                  updated_at = CASE WHEN state = ? THEN updated_at ELSE datetime('now') END
              WHERE id = ?`,
        args: [runState, approval ? JSON.stringify(approval) : null, runState, run.id],
      });
      if (wasUnreachable) await setTaskNote(taskId, null);

      let changed = false;
      if (target !== state) {
        changed = await transition(taskId, [state], target, { lastError: null });
      }
      if (approval && approval.requestId !== previous?.requestId) {
        await recordEvent(taskId, task.user_id, "jack", "approval_requested", {
          request_id: approval.requestId,
          tool: approval.tool,
          description: approval.description,
        }, run.id);
        changed = true;
      }
      return changed ? "updated" : "unchanged";
    }

    case "completed":
      return (await completeRun(task, run, remote, outcome.output)) ? "completed" : "unchanged";

    case "failed": {
      await db.execute({
        sql: `UPDATE agent_task_runs SET state = ?, error = ?, approval = NULL, finished_at = datetime('now'),
                last_polled_at = datetime('now'), unreachable_since = NULL, updated_at = datetime('now')
              WHERE id = ? AND state NOT IN ('completed', 'failed', 'cancelled', 'interrupted', 'lost')`,
        args: [outcome.runState, outcome.reason, run.id],
      });
      if (await transition(taskId, POLLED_STATES, "failed", { lastError: outcome.reason })) {
        await recordEvent(taskId, task.user_id, "jack", "failed", { run_status: outcome.runState }, run.id);
      }
      return "failed";
    }

    case "cancelled": {
      await db.execute({
        sql: `UPDATE agent_task_runs SET state = 'cancelled', approval = NULL, finished_at = datetime('now'),
                last_polled_at = datetime('now'), unreachable_since = NULL, updated_at = datetime('now')
              WHERE id = ? AND state NOT IN ('completed', 'failed', 'cancelled', 'interrupted', 'lost')`,
        args: [run.id],
      });
      if (await transition(taskId, POLLED_STATES, "cancelled", { lastError: null })) {
        await recordEvent(taskId, task.user_id, "jack", "cancelled", null, run.id);
      }
      return "cancelled";
    }

    case "unknown":
      await db.execute({
        sql: "UPDATE agent_task_runs SET last_polled_at = datetime('now') WHERE id = ?",
        args: [run.id],
      });
      console.warn(`[Jack] run ${run.id} reported an unrecognised status`);
      return "unchanged";
  }
}

function parseStoredApproval(raw: string | null): PendingApproval | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PendingApproval;
  } catch {
    return null;
  }
}

/** A one-line TL;DR without a model call: the first sentence of the first prose line. */
export function excerptSummary(output: string): string | null {
  const line = output
    .split("\n")
    .map((l) => l.replace(/^[#>*\-\s]+/, "").trim())
    .find((l) => l.length > 0 && !/^```/.test(l));
  if (!line) return null;
  const sentence = line.match(/^.{1,240}?[.!?](\s|$)/)?.[0]?.trim() ?? line;
  return sentence.length > 240 ? `${sentence.slice(0, 239)}…` : sentence;
}

/**
 * Store a completed run's output exactly once.
 *
 * One transaction: claim the run, insert the next version only if this run
 * has none yet, record which version it produced, advance the task. A second
 * poller racing this one inserts nothing; a crash before commit leaves the run
 * claimable on the next pass.
 */
async function completeRun(task: JackTaskRow, run: RunRow, remote: HermesRun, output: string): Promise<boolean> {
  const model = remote.runtime?.model
    ? `jack:${[remote.runtime.provider, remote.runtime.model].filter(Boolean).join("/")}`
    : "jack:hermes";
  const tokensIn = Number(remote.usage?.input_tokens ?? 0) || null;
  const tokensOut = Number(remote.usage?.output_tokens ?? 0) || null;
  const elapsed = Math.max(0, Date.now() - parseDbTime(run.created_at));
  const pending = `EXISTS (SELECT 1 FROM agent_task_runs WHERE id = ? AND state = 'completed' AND output_version IS NULL)`;

  const results = await db.batch(
    [
      {
        sql: `UPDATE agent_task_runs
              SET state = 'completed', approval = NULL, runtime_model = ?, tokens_input = ?, tokens_output = ?,
                  finished_at = datetime('now'), last_polled_at = datetime('now'), unreachable_since = NULL,
                  updated_at = datetime('now')
              WHERE id = ? AND state IN ('dispatching', 'running', 'awaiting_approval', 'stopping')`,
        args: [model, tokensIn, tokensOut, run.id],
      },
      {
        sql: `INSERT INTO agent_task_outputs
                (agent_task_id, version_number, content, content_type, model_used, tokens_input, tokens_output,
                 processing_time_ms, summary)
              SELECT ?, next.v, ?, ?, ?, ?, ?, ?, ?
              FROM (SELECT COALESCE(MAX(version_number), 0) + 1 AS v
                    FROM agent_task_outputs WHERE agent_task_id = ?) AS next
              -- Outside the aggregate on purpose: an aggregate always yields a
              -- row, so a guard inside it would not stop a second insert.
              WHERE ${pending}`,
        args: [
          task.id, output, task.output_format || "markdown", model, tokensIn, tokensOut, elapsed,
          excerptSummary(output), task.id, run.id,
        ],
      },
      {
        sql: `UPDATE agent_task_runs
              SET output_version = (SELECT MAX(version_number) FROM agent_task_outputs WHERE agent_task_id = ?)
              WHERE id = ? AND state = 'completed' AND output_version IS NULL`,
        args: [task.id, run.id],
      },
      {
        sql: `UPDATE agent_tasks
              SET current_version = (SELECT MAX(version_number) FROM agent_task_outputs WHERE agent_task_id = ?),
                  jack_state = 'awaiting_review', status = 'awaiting_review', last_error = NULL,
                  retry_count = 0, updated_at = datetime('now')
              WHERE id = ? AND jack_state IN ('dispatching', 'running', 'awaiting_approval', 'awaiting_input', 'cancelling')`,
        args: [task.id, task.id],
      },
    ],
    "write"
  );

  const inserted = (results?.[1]?.rowsAffected ?? 0) > 0;
  if (inserted) {
    await syncCoarse(task.id);
    await recordEvent(task.id, task.user_id, "jack", "output_ready", {
      model,
      finished_after_stop: stateOf(task) === "cancelling",
    }, run.id);
  }
  return inserted;
}

// ── Retrying stalled submissions ─────────────────────────────────────────────

function dispatchBackoffMs(attempts: number): number {
  return Math.min(10 * 60_000, 30_000 * 2 ** Math.max(0, attempts - 1));
}

/** Re-POST a submission whose earlier attempt did not get an answer. Same key, same bytes. */
async function retryDispatching(task: JackTaskRow, client: JackClient): Promise<DispatchOutcome | "waiting"> {
  const run = await latestRun(task.id);
  if (!run || run.state !== "dispatching") {
    // Claimed, but the run row was never written (crash in between). No request
    // left this server, so putting it back in the queue cannot double anything.
    if (Date.now() - parseDbTime(task.updated_at) > 2 * 60_000) {
      await transition(task.id, ["dispatching"], "queued", { lastError: null });
      return "retrying";
    }
    return "waiting";
  }
  if (Date.now() - parseDbTime(run.updated_at) < dispatchBackoffMs(run.dispatch_attempts)) return "waiting";
  return submitRun(task, run, client);
}

// ── User actions ─────────────────────────────────────────────────────────────

export class JackActionError extends Error {
  constructor(readonly status: 400 | 404 | 409 | 502 | 503, message: string) {
    super(message);
    this.name = "JackActionError";
  }
}

function requireClient(deps: JackDeps): JackClient {
  const { config, client } = connect(deps);
  if (!client) throw new JackActionError(503, config.reason ?? "Jack connection not configured.");
  return client;
}

/**
 * "Send to Jack" / "Retry". The one way a parked, failed or cancelled task
 * goes (back) to Jack, and the one way a legacy failed task becomes a Jack task.
 */
export async function sendToJack(taskId: string, userId: string, deps: JackDeps = {}): Promise<DispatchOutcome> {
  const client = requireClient(deps);
  const task = await getTaskForUser(taskId, userId);
  if (!task) throw new JackActionError(404, "Task not found");

  if (task.runtime !== "jack") {
    if (task.status !== "failed") {
      throw new JackActionError(409, "Only failed tasks from the previous runtime can be sent to Jack.");
    }
    await db.execute({
      sql: `UPDATE agent_tasks SET runtime = 'jack', jack_state = 'failed',
              jack_session_id = COALESCE(jack_session_id, 'brain-portal-task-' || id)
            WHERE id = ? AND runtime IS NULL`,
      args: [taskId],
    });
  }

  const state = stateOf((await getTask(taskId))!);
  if (!state || !SENDABLE_STATES.includes(state)) {
    throw new JackActionError(409, "This task is not in a state that can be sent to Jack.");
  }

  // A submission that never got an answer may have landed. Resend it under its
  // original key (Hermes returns the original run) instead of minting a new one.
  const previous = await latestRun(taskId);
  const reuse =
    previous &&
    previous.state === "abandoned" &&
    !previous.hermes_run_id &&
    Date.now() - parseDbTime(previous.created_at) < IDEMPOTENCY_REUSE_HOURS * 3_600_000;

  await recordEvent(taskId, userId, "user", "sent_to_jack", { resend_same_request: !!reuse });

  if (reuse && previous) {
    if (!(await transition(taskId, [state], "dispatching", { lastError: null }))) return "not_claimed";
    await db.execute({
      sql: `UPDATE agent_task_runs SET state = 'dispatching', dispatch_attempts = 0, error = NULL,
              finished_at = NULL, updated_at = datetime('now') WHERE id = ? AND state = 'abandoned'`,
      args: [previous.id],
    });
    const fresh = (await queryOne<RunRow>("SELECT * FROM agent_task_runs WHERE id = ?", [previous.id]))!;
    return submitRun((await getTask(taskId))!, fresh, client);
  }

  if (!(await transition(taskId, [state], "queued", { lastError: null }))) return "not_claimed";
  return dispatchJackTask(taskId, deps);
}

export async function cancelJackTask(taskId: string, userId: string, deps: JackDeps = {}): Promise<JackState> {
  const task = await getTaskForUser(taskId, userId);
  if (!task || task.runtime !== "jack") throw new JackActionError(404, "Task not found");
  const state = stateOf(task);
  if (!state) throw new JackActionError(409, "This task cannot be cancelled.");

  if (LOCALLY_CANCELLABLE_STATES.includes(state)) {
    if (!(await transition(taskId, [state], "cancelled", { lastError: null }))) {
      throw new JackActionError(409, "The task changed state; refresh and try again.");
    }
    await recordEvent(taskId, userId, "user", "cancelled", { from: state });
    return "cancelled";
  }

  if (state === "dispatching") {
    throw new JackActionError(409, "This task is being handed to Jack right now. Try again in a moment.");
  }
  if (state === "cancelling") return "cancelling";
  if (!REMOTELY_CANCELLABLE_STATES.includes(state)) {
    throw new JackActionError(409, "This task is not running.");
  }

  const client = requireClient(deps);
  const run = await queryOne<RunRow>(
    `SELECT * FROM agent_task_runs WHERE agent_task_id = ? AND hermes_run_id IS NOT NULL
     ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    [taskId]
  );
  if (!run?.hermes_run_id) throw new JackActionError(409, "No Jack run to stop.");

  try {
    await client.stopRun(run.hermes_run_id);
  } catch (error) {
    if (error instanceof JackError && error.kind === "not_found") {
      await reconcileJackTask(taskId, deps);
      throw new JackActionError(409, "Jack has no record of this run any more.");
    }
    throw new JackActionError(502, error instanceof JackError ? error.message : "Jack could not be reached.");
  }

  await db.execute({
    sql: "UPDATE agent_task_runs SET state = 'stopping', updated_at = datetime('now') WHERE id = ? AND state IN ('running', 'awaiting_approval')",
    args: [run.id],
  });
  await transition(taskId, REMOTELY_CANCELLABLE_STATES, "cancelling", { lastError: null });
  await recordEvent(taskId, userId, "user", "cancel_requested", null, run.id);
  return "cancelling";
}

export async function resolveJackApproval(
  taskId: string,
  userId: string,
  choice: ApprovalChoice,
  requestId: string | null,
  deps: JackDeps = {}
): Promise<void> {
  const task = await getTaskForUser(taskId, userId);
  if (!task || task.runtime !== "jack") throw new JackActionError(404, "Task not found");
  if (stateOf(task) !== "awaiting_approval") {
    throw new JackActionError(409, "Jack is not waiting for an approval on this task.");
  }

  const run = await queryOne<RunRow>(
    `SELECT * FROM agent_task_runs WHERE agent_task_id = ? AND state = 'awaiting_approval'
     ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    [taskId]
  );
  const pending = parseStoredApproval(run?.approval ?? null);
  if (!run?.hermes_run_id || !pending) throw new JackActionError(409, "There is no pending approval to resolve.");
  // The decision must be about the request Daniel was shown, not a newer one.
  if (pending.requestId && pending.requestId !== requestId) {
    throw new JackActionError(409, "That approval request is out of date. Refresh to see the current one.");
  }

  const client = requireClient(deps);
  try {
    await client.resolveApproval(run.hermes_run_id, choice, pending.requestId);
  } catch (error) {
    if (error instanceof JackError && (error.kind === "conflict" || error.kind === "not_found")) {
      await reconcileJackTask(taskId, deps);
      throw new JackActionError(409, error.message);
    }
    throw new JackActionError(502, error instanceof JackError ? error.message : "Jack could not be reached.");
  }

  await db.execute({
    sql: "UPDATE agent_task_runs SET approval = NULL, state = 'running', updated_at = datetime('now') WHERE id = ?",
    args: [run.id],
  });
  await transition(taskId, ["awaiting_approval"], "running", { lastError: null });
  await recordEvent(taskId, userId, "user", "approval_decided", {
    choice,
    request_id: pending.requestId,
    tool: pending.tool,
    description: pending.description,
  }, run.id);
}

/** Daniel's reply to an output: the next turn of the same Jack conversation. */
export async function requestJackRevision(
  taskId: string,
  userId: string,
  feedback: string,
  deps: JackDeps = {}
): Promise<DispatchOutcome> {
  const task = await getTaskForUser(taskId, userId);
  if (!task) throw new JackActionError(404, "Task not found");

  const state = stateOf(task);
  const reviewable =
    task.status === "awaiting_review" ||
    task.status === "revision_requested" ||
    (state !== null && ["failed", "cancelled", "needs_review"].includes(state) && (task.current_version ?? 0) > 0);
  if (!reviewable || (state && ["dispatching", "running", "awaiting_approval", "awaiting_input", "cancelling", "queued"].includes(state))) {
    throw new JackActionError(400, "Task not available for revision");
  }
  if ((task.current_version ?? 0) >= (task.max_revisions ?? 5)) {
    throw new JackActionError(400, "Maximum revisions reached");
  }

  await db.execute({
    sql: `INSERT INTO agent_task_feedback (agent_task_id, output_version, feedback_type, feedback_text)
          VALUES (?, ?, 'request_edit', ?)`,
    args: [taskId, task.current_version ?? 0, feedback],
  });

  // A historical OpenRouter task becomes a Jack task the moment Daniel asks for more.
  await db.execute({
    sql: `UPDATE agent_tasks
          SET runtime = 'jack',
              jack_state = COALESCE(jack_state, 'awaiting_review'),
              jack_session_id = COALESCE(jack_session_id, 'brain-portal-task-' || id)
          WHERE id = ?`,
    args: [taskId],
  });

  const current = stateOf((await getTask(taskId))!) ?? "awaiting_review";
  const { config } = connect(deps);
  const ready = config.state === "ready";
  if (!(await transition(taskId, [current], ready ? "queued" : "needs_dispatch", { lastError: ready ? null : config.reason }))) {
    throw new JackActionError(409, "The task changed state; refresh and try again.");
  }
  await recordEvent(taskId, userId, "user", "revision_requested", { version: task.current_version ?? 0 });
  return ready ? dispatchJackTask(taskId, deps) : "not_configured";
}

/** Review decisions on a Jack task keep `jack_state` truthful alongside the coarse status. */
export async function recordReviewDecision(
  taskId: string,
  userId: string,
  decision: "approved" | "rejected",
  reason: string | null = null
): Promise<void> {
  const task = await getTaskForUser(taskId, userId);
  if (!task || task.runtime !== "jack") return;
  const to: JackState = decision === "approved" ? "completed" : "rejected";
  await db.execute({
    sql: "UPDATE agent_tasks SET jack_state = ? WHERE id = ? AND runtime = 'jack'",
    args: [to, taskId],
  });
  await recordEvent(taskId, userId, "user", decision === "approved" ? "review_approved" : "review_rejected", reason ? { reason: reason.slice(0, 500) } : null);
}

// ── The queue pass (cron) ────────────────────────────────────────────────────

export interface QueuePassReport {
  configured: boolean;
  adopted: number;
  dispatched: number;
  retried: number;
  polled: number;
  completed: number;
  failed: number;
  unreachable: number;
  deferred: boolean;
}

export async function runJackQueuePass(
  deps: JackDeps = {},
  options: { budgetMs?: number; dispatchBatch?: number; pollBatch?: number } = {}
): Promise<QueuePassReport> {
  const started = Date.now();
  const budget = options.budgetMs ?? 240_000;
  const overBudget = () => Date.now() - started > budget;
  const { config, client } = connect(deps);

  const report: QueuePassReport = {
    configured: !!client,
    adopted: await adoptNewTasks(config),
    dispatched: 0,
    retried: 0,
    polled: 0,
    completed: 0,
    failed: 0,
    unreachable: 0,
    deferred: false,
  };

  // Jack off: nothing is sent and nothing is polled. Work stays where it is,
  // visibly, until Jack is configured.
  if (!client) return report;

  const queued = await queryAll<{ id: string }>(
    `SELECT id FROM agent_tasks WHERE runtime = 'jack' AND jack_state = 'queued'
     ORDER BY created_at ASC LIMIT ?`,
    [options.dispatchBatch ?? 5]
  );
  for (const { id } of queued) {
    if (overBudget()) { report.deferred = true; break; }
    const outcome = await dispatchJackTask(id, { ...deps, config, client });
    if (outcome === "dispatched") report.dispatched++;
    if (outcome === "failed") report.failed++;
  }

  const dispatching = await queryAll<JackTaskRow>(
    `SELECT * FROM agent_tasks WHERE runtime = 'jack' AND jack_state = 'dispatching'
     ORDER BY updated_at ASC LIMIT 10`
  );
  for (const task of dispatching) {
    if (overBudget()) { report.deferred = true; break; }
    const outcome = await retryDispatching(task, client);
    if (outcome !== "waiting") report.retried++;
    if (outcome === "failed") report.failed++;
    if (outcome === "retrying" && (await getTask(task.id))?.jack_state === "queued") {
      if ((await dispatchJackTask(task.id, { ...deps, config, client })) === "dispatched") report.dispatched++;
    }
  }

  const active = await queryAll<{ id: string }>(
    `SELECT at.id FROM agent_tasks at
     LEFT JOIN agent_task_runs r ON r.id = (
       SELECT id FROM agent_task_runs WHERE agent_task_id = at.id ORDER BY created_at DESC, rowid DESC LIMIT 1)
     WHERE at.runtime = 'jack' AND at.jack_state IN (${POLLED_STATES.map(() => "?").join(", ")})
     ORDER BY COALESCE(r.last_polled_at, '') ASC LIMIT ?`,
    [...POLLED_STATES, options.pollBatch ?? 25]
  );
  for (const { id } of active) {
    if (overBudget()) { report.deferred = true; break; }
    const outcome = await reconcileJackTask(id, { ...deps, config, client });
    report.polled++;
    if (outcome === "completed") report.completed++;
    if (outcome === "failed") report.failed++;
    if (outcome === "unreachable") report.unreachable++;
  }

  return report;
}
