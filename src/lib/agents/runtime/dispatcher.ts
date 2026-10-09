/**
 * The delegated-task dispatcher: the only code that moves a task through its
 * lifecycle, and the only code that talks to a runtime.
 *
 * Brain Portal owns the records; the configured runtime executes. Which one is
 * `AGENT_RUNTIME`'s choice alone (see `config.ts`), and there is no fallback
 * between them: a Hermes deployment never reaches OpenRouter, and an
 * OpenRouter deployment never reaches a Hermes endpoint.
 *
 *   Hermes (asynchronous, tools, approvals):
 *   queued ─claim─▶ dispatching ─POST /v1/runs─▶ running ─poll─▶ awaiting_review
 *                        │ (same key, same bytes, bounded)      ├─▶ awaiting_approval ⇄ running
 *                        └─▶ failed                             ├─▶ failed / cancelled
 *                                                               └─▶ (stop) cancelling ─▶ cancelled
 *
 *   OpenRouter (one model call, no tools, no side effects):
 *   queued ─claim─▶ running ─completion─▶ awaiting_review
 *                                └─▶ failed ─(retry budget, backoff)─▶ queued
 *
 * Every network call is made against state that was durably recorded first,
 * so a crash at any point leaves something the next queue pass can finish
 * honestly.
 */

import { randomUUID } from "node:crypto";
import { db, queryAll, queryOne } from "@/lib/db/client";
import type { AgentTask, AgentTaskOutput } from "@/lib/db/schema";
import { getCompiledGuardrails } from "@/lib/guardrails";
import { buildAnnotationPromptSection } from "@/lib/annotations";
import { redactSecrets } from "@/lib/system-health/diagnose";
import { syncTaskStatusFromAgentTask } from "../status-sync";
import { getRuntimeConfig, type RuntimeConfig } from "./config";
import { RuntimeError } from "./errors";
import { createHermesClient, type HermesClient, type HermesRun } from "./hermes-client";
import { runOpenRouterTask, type CompleteFn } from "./openrouter";
import { buildEnvelope, type EnvelopeInput, type EnvelopeSourceType } from "./envelope";
import {
  coarseStatus,
  interpretRunStatus,
  isTaskState,
  parsePendingApproval,
  redactAgentText,
  sessionIdForTask,
  LOCALLY_CANCELLABLE_STATES,
  POLLED_STATES,
  REMOTELY_CANCELLABLE_STATES,
  SENDABLE_STATES,
  type ApprovalChoice,
  type PendingApproval,
  type RuntimeName,
  type TaskState,
} from "./types";

// ── Dependencies ─────────────────────────────────────────────────────────────

export interface RuntimeDeps {
  config?: RuntimeConfig;
  /** Injected in tests; built from `config` otherwise. Used only when the runtime is `hermes`. */
  hermes?: HermesClient;
  /** Injected in tests; the real OpenRouter completion otherwise. Used only when the runtime is `openrouter`. */
  complete?: CompleteFn;
  /** Per-request timeout for Hermes calls. UI-triggered polls pass a short one. */
  timeoutMs?: number;
  /**
   * Run the dispatch after the response instead of inside it (route handlers
   * pass Next's `after`). An OpenRouter run is a full model call; a request
   * should not wait for it. The queue pass picks up anything this misses.
   */
  schedule?: (work: () => Promise<unknown>) => void;
}

interface Resolved {
  config: RuntimeConfig;
  /** The runtime that may be used right now, or null (off or misconfigured). */
  runtime: RuntimeName | null;
  /** Present only when the runtime is `hermes`. */
  hermes: HermesClient | null;
}

function resolve(deps: RuntimeDeps = {}): Resolved {
  const config = deps.config ?? getRuntimeConfig();
  if (config.state !== "ready" || !config.runtime) return { config, runtime: null, hermes: null };
  if (config.runtime === "hermes") {
    const hermes = deps.hermes ?? createHermesClient(config.hermes!, { timeoutMs: deps.timeoutMs });
    return { config, runtime: "hermes", hermes };
  }
  return { config, runtime: "openrouter", hermes: null };
}

/** Automatic Hermes submit retries, only for outcomes where Hermes deduplicates by key. */
export const MAX_DISPATCH_ATTEMPTS = 6;
/** Hermes keeps idempotency keys for 24h; re-using one later could start a second run. */
const IDEMPOTENCY_REUSE_HOURS = 23;
/** An OpenRouter run with no answer after this long died with its worker. */
const SYNC_RUN_STUCK_MINUTES = 10;
/** Backoff before an OpenRouter failure is retried automatically. */
const SYNC_RETRY_BACKOFF_MINUTES = 5;

// ── Row shapes ───────────────────────────────────────────────────────────────

export type ManagedTaskRow = AgentTask & {
  runtime: string | null;
  runtime_state: string | null;
  runtime_session_id: string | null;
};

export interface RunRow {
  id: string;
  agent_task_id: string;
  user_id: string;
  runtime: string;
  kind: "initial" | "revision" | "retry";
  idempotency_key: string;
  request_body: string;
  state: string;
  external_run_id: string | null;
  session_id: string | null;
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

export async function getTaskForUser(taskId: string, userId: string): Promise<ManagedTaskRow | null> {
  return queryOne<ManagedTaskRow>("SELECT * FROM agent_tasks WHERE id = ? AND user_id = ?", [taskId, userId]);
}

async function getTask(taskId: string): Promise<ManagedTaskRow | null> {
  return queryOne<ManagedTaskRow>("SELECT * FROM agent_tasks WHERE id = ?", [taskId]);
}

export async function latestRun(taskId: string): Promise<RunRow | null> {
  return queryOne<RunRow>(
    "SELECT * FROM agent_task_runs WHERE agent_task_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
    [taskId]
  );
}

function stateOf(task: Pick<ManagedTaskRow, "runtime_state">): TaskState | null {
  return isTaskState(task.runtime_state) ? task.runtime_state : null;
}

function newId(): string {
  return randomUUID().replace(/-/g, "");
}

// ── Audit trail ──────────────────────────────────────────────────────────────

export type EventActor = "user" | "agent" | "system";

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
    console.error(`[AgentRuntime] could not record ${kind} for ${taskId}:`, error instanceof Error ? error.message : error);
  }
}

// ── State transitions ────────────────────────────────────────────────────────

/**
 * Conditionally move a task between states, keeping the coarse status and the
 * linked task row in step. Returns false when the task was not in one of
 * `from`: someone else got there first, which callers treat as "stand down".
 */
export async function transition(
  taskId: string,
  from: readonly TaskState[],
  to: TaskState,
  options: { lastError?: string | null } = {}
): Promise<boolean> {
  const withOutput = coarseStatus(to, 1);
  const withoutOutput = coarseStatus(to, 0);
  const setError = options.lastError !== undefined;
  const result = await db.execute({
    sql: `UPDATE agent_tasks
          SET runtime_state = ?,
              status = CASE WHEN COALESCE(current_version, 0) > 0 THEN ? ELSE ? END,
              ${setError ? "last_error = ?," : ""}
              updated_at = datetime('now')
          WHERE id = ? AND runtime_state IN (${from.map(() => "?").join(", ")})`,
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
    console.error(`[AgentRuntime] status sync failed for ${taskId}:`, error instanceof Error ? error.message : error);
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
 * Take ownership of rows written by paths that know nothing about the
 * lifecycle: the MCP server (its own libsql client, outside Next.js),
 * heartbeat, skills and the task routes insert `status = 'queued'` with
 * `runtime_state` NULL.
 *
 * Only `queued` rows: the migration parked every legacy row in another state,
 * so a `queued` row with no state is new work by construction.
 */
export async function adoptNewTasks(config: RuntimeConfig, taskId?: string): Promise<number> {
  const ready = config.state === "ready";
  const result = await db.execute({
    sql: `UPDATE agent_tasks
          SET runtime_state = ?,
              runtime_session_id = COALESCE(runtime_session_id, 'brain-portal-task-' || id),
              last_error = ?,
              updated_at = datetime('now')
          WHERE runtime_state IS NULL AND status = 'queued' ${taskId ? "AND id = ?" : ""}`,
    args: [
      ready ? "queued" : "needs_dispatch",
      ready ? null : config.reason,
      ...(taskId ? [taskId] : []),
    ],
  });
  return result?.rowsAffected ?? 0;
}

/** For callers that just inserted a row (skills): adopt it and run it now if possible. */
export async function adoptAndDispatch(taskId: string, deps: RuntimeDeps = {}): Promise<DispatchOutcome> {
  const { config } = resolve(deps);
  await adoptNewTasks(config, taskId);
  return dispatchSoon(taskId, deps);
}

// ── Creating ─────────────────────────────────────────────────────────────────

export interface CreateTaskInput {
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

export async function createDelegatedTask(
  input: CreateTaskInput,
  deps: RuntimeDeps = {}
): Promise<{ task: ManagedTaskRow; outcome: DispatchOutcome }> {
  const { config } = resolve(deps);
  const ready = config.state === "ready";
  const id = newId();

  await db.execute({
    sql: `INSERT INTO agent_tasks
            (id, user_id, task_id, title, description, task_type, assigned_agent, priority,
             output_format, context_note_ids, context_urls, project_id, source_type, source_id,
             routed_by, status, runtime_state, runtime_session_id, last_error)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)`,
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
    runtime_available: ready,
  });

  const outcome = ready ? await dispatchSoon(id, deps) : "not_configured";
  const task = (await getTask(id))!;
  return { task, outcome };
}

// ── Dispatch ─────────────────────────────────────────────────────────────────

export type DispatchOutcome =
  /** Handed to `deps.schedule`; it runs after the response. */
  | "scheduled"
  /** Hermes accepted the run; it continues asynchronously. */
  | "dispatched"
  /** OpenRouter answered; the output is stored. */
  | "completed"
  | "retrying"
  | "failed"
  | "not_claimed"
  | "not_configured";

/**
 * Dispatch now, or after the response when the caller provided a scheduler
 * and the runtime is OpenRouter. Only that runtime is slow to dispatch (it is
 * the whole model call); a Hermes submission returns at once, so it runs
 * inline and the response carries the task's real state.
 */
function dispatchSoon(taskId: string, deps: RuntimeDeps): Promise<DispatchOutcome> {
  const config = deps.config ?? getRuntimeConfig();
  if (!deps.schedule || config.state !== "ready" || config.runtime !== "openrouter") {
    return dispatchTask(taskId, { ...deps, config });
  }
  const { schedule, ...rest } = deps;
  schedule(() =>
    dispatchTask(taskId, rest).catch((error) => {
      console.error(`[AgentRuntime] deferred dispatch of ${taskId} failed:`, error instanceof Error ? error.message : error);
    })
  );
  return Promise.resolve("scheduled");
}

/**
 * Hand a `queued` task to the configured runtime. Safe to call from anywhere,
 * any number of times: the conditional claim lets exactly one caller proceed.
 */
export async function dispatchTask(taskId: string, deps: RuntimeDeps = {}): Promise<DispatchOutcome> {
  const resolved = resolve(deps);
  const { config, runtime } = resolved;

  if (!runtime) {
    await transition(taskId, ["queued"], "needs_dispatch", { lastError: config.reason });
    return "not_configured";
  }

  // The runtime is stamped at claim time: it records what actually ran the work.
  const claim = await db.execute({
    sql: `UPDATE agent_tasks
          SET runtime_state = 'dispatching', runtime = ?, status = 'processing', updated_at = datetime('now')
          WHERE id = ? AND runtime_state = 'queued'`,
    args: [runtime, taskId],
  });
  if ((claim?.rowsAffected ?? 0) === 0) return "not_claimed";
  await syncCoarse(taskId);

  const task = await getTask(taskId);
  if (!task) return "not_claimed";

  let run: RunRow;
  let envelopeInput: EnvelopeInput;
  try {
    envelopeInput = await loadEnvelopeInput(task);
    const envelope = buildEnvelope(envelopeInput, runtime);
    const sessionId = runtime === "hermes" ? task.runtime_session_id || sessionIdForTask(task.id) : null;
    const body =
      runtime === "hermes"
        ? { input: envelope.input, instructions: envelope.instructions, session_id: sessionId }
        : { input: envelope.input, instructions: envelope.instructions };
    const runId = newId();
    const kind = envelopeInput.revision ? "revision" : (await latestRun(taskId)) ? "retry" : "initial";

    // Recorded before the request, so a crash after Hermes accepted the run is
    // recovered by replaying these exact bytes under this exact key.
    await db.execute({
      sql: `INSERT INTO agent_task_runs
              (id, agent_task_id, user_id, runtime, kind, idempotency_key, request_body, state, session_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        runId, taskId, task.user_id, runtime, kind, `brain-portal:${runId}:${randomUUID()}`,
        JSON.stringify(body), runtime === "hermes" ? "dispatching" : "running", sessionId,
      ],
    });
    run = (await queryOne<RunRow>("SELECT * FROM agent_task_runs WHERE id = ?", [runId]))!;
  } catch (error) {
    console.error(`[AgentRuntime] could not prepare ${taskId}:`, error instanceof Error ? error.message : error);
    await transition(taskId, ["dispatching"], "failed", {
      lastError: "Brain Portal could not assemble this task's context, so nothing was sent. Retry, and report it if it repeats.",
    });
    await recordEvent(taskId, task.user_id, "system", "failed", { stage: "prepare" });
    return "failed";
  }

  if (runtime === "hermes") return submitHermesRun(task, run, resolved.hermes!);
  return runOpenRouter(task, run, envelopeInput, deps);
}

// ── OpenRouter: synchronous ──────────────────────────────────────────────────

async function runOpenRouter(
  task: ManagedTaskRow,
  run: RunRow,
  envelopeInput: EnvelopeInput,
  deps: RuntimeDeps
): Promise<DispatchOutcome> {
  await transition(task.id, ["dispatching"], "running", { lastError: null });
  await recordEvent(task.id, task.user_id, "agent", "dispatched", { runtime: "openrouter" }, run.id);

  const body = JSON.parse(run.request_body) as { input: string; instructions: string };
  try {
    const result = await runOpenRouterTask(
      {
        userId: task.user_id,
        agentType: task.assigned_agent,
        sourceType: envelopeInput.source.type,
        instructionLength: task.description.length,
        isRevision: !!envelopeInput.revision,
        input: body.input,
        instructions: body.instructions,
      },
      deps.complete
    );
    const stored = await completeRun(task, run, {
      output: result.output,
      model: result.model,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
    });
    return stored ? "completed" : "not_claimed";
  } catch (error) {
    // A model call has no side effects, so a failure is retried automatically
    // by the queue pass while `retry_count` stays under `max_retries`.
    const message = redactSecrets(error instanceof Error ? error.message : "The model request failed.");
    await db.batch(
      [
        {
          sql: `UPDATE agent_task_runs SET state = 'failed', error = ?, finished_at = datetime('now'),
                  updated_at = datetime('now') WHERE id = ? AND state = 'running'`,
          args: [message, run.id],
        },
        {
          sql: `UPDATE agent_tasks SET retry_count = COALESCE(retry_count, 0) + 1 WHERE id = ?`,
          args: [task.id],
        },
      ],
      "write"
    );
    await transition(task.id, ["running"], "failed", { lastError: message });
    await recordEvent(task.id, task.user_id, "agent", "failed", { runtime: "openrouter" }, run.id);
    return "failed";
  }
}

// ── Hermes: asynchronous ─────────────────────────────────────────────────────

async function submitHermesRun(task: ManagedTaskRow, run: RunRow, hermes: HermesClient): Promise<DispatchOutcome> {
  const attempts = (run.dispatch_attempts ?? 0) + 1;
  try {
    const { runId: externalRunId, replayed } = await hermes.createRun(JSON.parse(run.request_body), run.idempotency_key);
    await db.batch(
      [
        {
          sql: `UPDATE agent_task_runs
                SET state = 'running', external_run_id = ?, dispatch_attempts = ?, last_dispatch_error = NULL,
                    unreachable_since = NULL, updated_at = datetime('now')
                WHERE id = ? AND state = 'dispatching'`,
          args: [externalRunId, attempts, run.id],
        },
        {
          sql: `UPDATE agent_tasks
                SET runtime_state = 'running', status = 'processing', last_error = NULL, updated_at = datetime('now')
                WHERE id = ? AND runtime_state = 'dispatching'`,
          args: [task.id],
        },
      ],
      "write"
    );
    await syncCoarse(task.id);
    await recordEvent(task.id, task.user_id, "agent", "dispatched", { runtime: "hermes", run_id: externalRunId, replayed }, run.id);
    return "dispatched";
  } catch (error) {
    const err = error instanceof RuntimeError ? error : new RuntimeError("unreachable", "The Hermes agent could not be reached.");

    if (err.retryable && attempts < MAX_DISPATCH_ATTEMPTS) {
      await db.execute({
        sql: `UPDATE agent_task_runs
              SET dispatch_attempts = ?, last_dispatch_error = ?, updated_at = datetime('now')
              WHERE id = ?`,
        args: [attempts, err.message, run.id],
      });
      await setTaskNote(task.id, `Sending: ${err.message} Retrying automatically (attempt ${attempts} of ${MAX_DISPATCH_ATTEMPTS}).`);
      return "retrying";
    }

    // Retryable but out of budget: the request may still have landed, so the
    // run row keeps its key ("abandoned", not "failed") for an explicit Retry.
    const runState = err.retryable ? "abandoned" : "failed";
    const message = err.retryable
      ? `The Hermes agent could not be reached after ${attempts} attempts (${err.message}) Retry re-sends the same request; if the agent did receive it, it continues that run instead of starting a second one.`
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

/** Every read is scoped to the task's owner; nothing reaches a runtime that the owner does not own. */
export async function loadEnvelopeInput(task: ManagedTaskRow): Promise<EnvelopeInput> {
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
        // Name and type only. Channels and history are personal data a Hermes
        // agent can fetch over MCP (`get_contact_brief`) when the task needs them.
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

// ── Polling (Hermes) ─────────────────────────────────────────────────────────

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
 * Bring one Hermes task's state in line with what the agent reports.
 * Idempotent; any number of concurrent callers converge on one output version.
 * Tasks on other runtimes, or on Hermes while this server is not configured
 * for Hermes, are skipped: nothing is ever routed to a different runtime.
 */
export async function reconcileTask(
  taskId: string,
  deps: RuntimeDeps = {},
  options: { minIntervalMs?: number } = {}
): Promise<ReconcileOutcome> {
  const { config, runtime, hermes } = resolve(deps);
  if (runtime !== "hermes" || !hermes) return "skipped";
  const secrets = [config.hermes!.apiKey, ...Object.values(config.hermes!.edgeHeaders)];
  const redact = (text: string) => redactSecrets(redactAgentText(text, secrets));

  const task = await getTask(taskId);
  const state = task ? stateOf(task) : null;
  if (!task || task.runtime !== "hermes" || !state || !POLLED_STATES.includes(state)) return "skipped";

  const run = await queryOne<RunRow>(
    `SELECT * FROM agent_task_runs WHERE agent_task_id = ? AND external_run_id IS NOT NULL
     ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    [taskId]
  );
  if (!run?.external_run_id) return "skipped";

  if (options.minIntervalMs && Date.now() - parseDbTime(run.last_polled_at) < options.minIntervalMs) {
    return "skipped";
  }

  let remote: HermesRun;
  try {
    remote = await hermes.getRun(run.external_run_id);
  } catch (error) {
    const err = error instanceof RuntimeError ? error : new RuntimeError("unreachable", "The Hermes agent could not be reached.");
    if (err.kind === "not_found") {
      await db.execute({
        sql: `UPDATE agent_task_runs SET state = 'lost', error = ?, finished_at = datetime('now'),
                last_polled_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
        args: [err.message, run.id],
      });
      await transition(taskId, POLLED_STATES, "failed", {
        lastError: `The Hermes agent no longer has a record of this run, so its result could not be collected. Open the Hermes session "${run.session_id ?? sessionIdForTask(taskId)}" to see what happened, or retry.`,
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
        : `Hermes agent unreachable since ${since} UTC; this task's status is unknown until it answers. Still checking. (${err.message})`
    );
    return "unreachable";
  }

  const wasUnreachable = !!run.unreachable_since;
  const outcome = interpretRunStatus(remote.status, remote.output, remote.error);

  switch (outcome.kind) {
    case "in_progress": {
      // A stop request stays "stopping" in Brain Portal until the agent settles it.
      const target: TaskState = state === "cancelling" ? "cancelling" : outcome.state;
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
        await recordEvent(taskId, task.user_id, "agent", "approval_requested", {
          request_id: approval.requestId,
          tool: approval.tool,
          description: approval.description,
        }, run.id);
        changed = true;
      }
      return changed ? "updated" : "unchanged";
    }

    case "completed": {
      const model = remote.runtime?.model
        ? `hermes:${[remote.runtime.provider, remote.runtime.model].filter(Boolean).join("/")}`
        : "hermes";
      const stored = await completeRun(task, run, {
        output: outcome.output,
        model,
        tokensIn: Number(remote.usage?.input_tokens ?? 0) || null,
        tokensOut: Number(remote.usage?.output_tokens ?? 0) || null,
      });
      return stored ? "completed" : "unchanged";
    }

    case "failed": {
      await db.execute({
        sql: `UPDATE agent_task_runs SET state = ?, error = ?, approval = NULL, finished_at = datetime('now'),
                last_polled_at = datetime('now'), unreachable_since = NULL, updated_at = datetime('now')
              WHERE id = ? AND state NOT IN ('completed', 'failed', 'cancelled', 'interrupted', 'lost')`,
        args: [outcome.runState, outcome.reason, run.id],
      });
      if (await transition(taskId, POLLED_STATES, "failed", { lastError: outcome.reason })) {
        await recordEvent(taskId, task.user_id, "agent", "failed", { run_status: outcome.runState }, run.id);
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
        await recordEvent(taskId, task.user_id, "agent", "cancelled", null, run.id);
      }
      return "cancelled";
    }

    case "unknown":
      await db.execute({
        sql: "UPDATE agent_task_runs SET last_polled_at = datetime('now') WHERE id = ?",
        args: [run.id],
      });
      console.warn(`[AgentRuntime] run ${run.id} reported an unrecognised status`);
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

interface CompletedOutput {
  output: string;
  model: string;
  tokensIn: number | null;
  tokensOut: number | null;
}

/**
 * Store a completed run's output exactly once, whichever runtime produced it.
 *
 * One transaction: claim the run, insert the next version only if this run
 * has none yet, record which version it produced, advance the task. A second
 * caller racing this one inserts nothing; a crash before commit leaves the run
 * claimable on the next pass.
 */
async function completeRun(task: ManagedTaskRow, run: RunRow, result: CompletedOutput): Promise<boolean> {
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
        args: [result.model, result.tokensIn, result.tokensOut, run.id],
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
          task.id, result.output, task.output_format || "markdown", result.model, result.tokensIn ?? 0,
          result.tokensOut ?? 0, elapsed, excerptSummary(result.output), task.id, run.id,
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
                  runtime_state = 'awaiting_review', status = 'awaiting_review', last_error = NULL,
                  retry_count = 0, updated_at = datetime('now')
              WHERE id = ? AND runtime_state IN ('dispatching', 'running', 'awaiting_approval', 'awaiting_input', 'cancelling')`,
        args: [task.id, task.id],
      },
    ],
    "write"
  );

  const inserted = (results?.[1]?.rowsAffected ?? 0) > 0;
  if (inserted) {
    await syncCoarse(task.id);
    await recordEvent(task.id, task.user_id, "agent", "output_ready", {
      model: result.model,
      finished_after_stop: stateOf(task) === "cancelling",
    }, run.id);
  }
  return inserted;
}

// ── Recovering stalled work ──────────────────────────────────────────────────

function dispatchBackoffMs(attempts: number): number {
  return Math.min(10 * 60_000, 30_000 * 2 ** Math.max(0, attempts - 1));
}

/** Re-POST a Hermes submission whose earlier attempt did not get an answer. Same key, same bytes. */
async function retryHermesDispatching(task: ManagedTaskRow, hermes: HermesClient): Promise<DispatchOutcome | "waiting"> {
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
  return submitHermesRun(task, run, hermes);
}

/**
 * OpenRouter work that died with its worker (a run left `running` past the
 * timeout) and OpenRouter failures with retry budget left go back in the
 * queue. Safe because a model call has no side effects; never applied to
 * Hermes, whose runs may have acted.
 */
async function recoverOpenRouterWork(): Promise<number> {
  await db.execute({
    sql: `UPDATE agent_task_runs
          SET state = 'abandoned', error = 'Stopped part-way (worker timed out)', finished_at = datetime('now'),
              updated_at = datetime('now')
          WHERE runtime = 'openrouter' AND state = 'running' AND datetime(updated_at) < datetime('now', ?)`,
    args: [`-${SYNC_RUN_STUCK_MINUTES} minutes`],
  });
  const requeuedStuck = await db.execute({
    sql: `UPDATE agent_tasks
          SET runtime_state = CASE WHEN COALESCE(retry_count, 0) + 1 < COALESCE(max_retries, 3) THEN 'queued' ELSE 'failed' END,
              status = CASE
                WHEN COALESCE(retry_count, 0) + 1 < COALESCE(max_retries, 3)
                  THEN CASE WHEN COALESCE(current_version, 0) > 0 THEN 'revision_requested' ELSE 'queued' END
                ELSE CASE WHEN COALESCE(current_version, 0) > 0 THEN 'awaiting_review' ELSE 'failed' END END,
              retry_count = COALESCE(retry_count, 0) + 1,
              last_error = 'The model request stopped part-way and was retried.',
              updated_at = datetime('now')
          WHERE runtime = 'openrouter' AND runtime_state = 'running'
            AND NOT EXISTS (
              SELECT 1 FROM agent_task_runs r
              WHERE r.agent_task_id = agent_tasks.id AND r.state = 'running')`,
  });
  const retried = await db.execute({
    sql: `UPDATE agent_tasks
          SET runtime_state = 'queued',
              status = CASE WHEN COALESCE(current_version, 0) > 0 THEN 'revision_requested' ELSE 'queued' END,
              updated_at = datetime('now')
          WHERE runtime = 'openrouter' AND runtime_state = 'failed'
            AND COALESCE(retry_count, 0) < COALESCE(max_retries, 3)
            AND datetime(updated_at) < datetime('now', ?)
            AND datetime(updated_at) > datetime('now', '-1 day')`,
    args: [`-${SYNC_RETRY_BACKOFF_MINUTES} minutes`],
  });
  return (requeuedStuck?.rowsAffected ?? 0) + (retried?.rowsAffected ?? 0);
}

// ── User actions ─────────────────────────────────────────────────────────────

export class RuntimeActionError extends Error {
  constructor(readonly status: 400 | 404 | 409 | 502 | 503, message: string) {
    super(message);
    this.name = "RuntimeActionError";
  }
}

function requireRuntime(deps: RuntimeDeps): Resolved & { runtime: RuntimeName } {
  const resolved = resolve(deps);
  if (!resolved.runtime) {
    throw new RuntimeActionError(503, resolved.config.reason ?? "Delegated tasks are not configured on this server.");
  }
  return resolved as Resolved & { runtime: RuntimeName };
}

/**
 * "Send" / "Retry". The one way a parked, failed or cancelled task goes (back)
 * to the runtime, and the one way a legacy failed task joins the lifecycle.
 */
export async function sendTask(taskId: string, userId: string, deps: RuntimeDeps = {}): Promise<DispatchOutcome> {
  const resolved = requireRuntime(deps);
  const task = await getTaskForUser(taskId, userId);
  if (!task) throw new RuntimeActionError(404, "Task not found");

  if (!task.runtime_state) {
    if (task.status !== "failed") {
      throw new RuntimeActionError(409, "Only failed tasks from the earlier executor can be sent again.");
    }
    await db.execute({
      sql: `UPDATE agent_tasks SET runtime_state = 'failed',
              runtime_session_id = COALESCE(runtime_session_id, 'brain-portal-task-' || id)
            WHERE id = ? AND runtime_state IS NULL`,
      args: [taskId],
    });
  }

  const state = stateOf((await getTask(taskId))!);
  if (!state || !SENDABLE_STATES.includes(state)) {
    throw new RuntimeActionError(409, "This task is not in a state that can be sent.");
  }

  // An explicit send is a fresh start for the automatic retry budget.
  await db.execute({ sql: "UPDATE agent_tasks SET retry_count = 0 WHERE id = ?", args: [taskId] });

  // A Hermes submission that never got an answer may have landed. Resend it
  // under its original key (Hermes returns the original run) instead of
  // minting a new one.
  const previous = await latestRun(taskId);
  const reuse =
    resolved.runtime === "hermes" &&
    previous &&
    previous.runtime === "hermes" &&
    previous.state === "abandoned" &&
    !previous.external_run_id &&
    Date.now() - parseDbTime(previous.created_at) < IDEMPOTENCY_REUSE_HOURS * 3_600_000;

  await recordEvent(taskId, userId, "user", "sent_to_agent", { runtime: resolved.runtime, resend_same_request: !!reuse });

  if (reuse && previous) {
    if (!(await transition(taskId, [state], "dispatching", { lastError: null }))) return "not_claimed";
    await db.execute({
      sql: `UPDATE agent_task_runs SET state = 'dispatching', dispatch_attempts = 0, error = NULL,
              finished_at = NULL, updated_at = datetime('now') WHERE id = ? AND state = 'abandoned'`,
      args: [previous.id],
    });
    await db.execute({ sql: "UPDATE agent_tasks SET runtime = 'hermes' WHERE id = ?", args: [taskId] });
    const fresh = (await queryOne<RunRow>("SELECT * FROM agent_task_runs WHERE id = ?", [previous.id]))!;
    return submitHermesRun((await getTask(taskId))!, fresh, resolved.hermes!);
  }

  if (!(await transition(taskId, [state], "queued", { lastError: null }))) return "not_claimed";
  return dispatchSoon(taskId, deps);
}

export async function cancelTask(taskId: string, userId: string, deps: RuntimeDeps = {}): Promise<TaskState> {
  const task = await getTaskForUser(taskId, userId);
  if (!task || !task.runtime_state) throw new RuntimeActionError(404, "Task not found");
  const state = stateOf(task);
  if (!state) throw new RuntimeActionError(409, "This task cannot be cancelled.");

  if (LOCALLY_CANCELLABLE_STATES.includes(state)) {
    if (!(await transition(taskId, [state], "cancelled", { lastError: null }))) {
      throw new RuntimeActionError(409, "The task changed state; refresh and try again.");
    }
    await recordEvent(taskId, userId, "user", "cancelled", { from: state });
    return "cancelled";
  }

  if (state === "dispatching") {
    throw new RuntimeActionError(409, "This task is being sent right now. Try again in a moment.");
  }
  if (state === "cancelling") return "cancelling";
  if (!REMOTELY_CANCELLABLE_STATES.includes(state)) {
    throw new RuntimeActionError(409, "This task is not running.");
  }
  if (task.runtime !== "hermes") {
    throw new RuntimeActionError(409, "A model request already in progress cannot be stopped; it finishes within a few minutes.");
  }

  const { runtime, hermes } = requireRuntime(deps);
  if (runtime !== "hermes" || !hermes) {
    throw new RuntimeActionError(503, "This task runs on a Hermes agent, but this server is not configured for Hermes.");
  }
  const run = await queryOne<RunRow>(
    `SELECT * FROM agent_task_runs WHERE agent_task_id = ? AND external_run_id IS NOT NULL
     ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    [taskId]
  );
  if (!run?.external_run_id) throw new RuntimeActionError(409, "There is no run to stop.");

  try {
    await hermes.stopRun(run.external_run_id);
  } catch (error) {
    if (error instanceof RuntimeError && error.kind === "not_found") {
      await reconcileTask(taskId, deps);
      throw new RuntimeActionError(409, "The Hermes agent has no record of this run any more.");
    }
    throw new RuntimeActionError(502, error instanceof RuntimeError ? error.message : "The Hermes agent could not be reached.");
  }

  await db.execute({
    sql: "UPDATE agent_task_runs SET state = 'stopping', updated_at = datetime('now') WHERE id = ? AND state IN ('running', 'awaiting_approval')",
    args: [run.id],
  });
  await transition(taskId, REMOTELY_CANCELLABLE_STATES, "cancelling", { lastError: null });
  await recordEvent(taskId, userId, "user", "cancel_requested", null, run.id);
  return "cancelling";
}

export async function resolveApproval(
  taskId: string,
  userId: string,
  choice: ApprovalChoice,
  requestId: string | null,
  deps: RuntimeDeps = {}
): Promise<void> {
  const task = await getTaskForUser(taskId, userId);
  if (!task || !task.runtime_state) throw new RuntimeActionError(404, "Task not found");
  if (stateOf(task) !== "awaiting_approval" || task.runtime !== "hermes") {
    throw new RuntimeActionError(409, "Nothing on this task is waiting for an approval.");
  }

  const run = await queryOne<RunRow>(
    `SELECT * FROM agent_task_runs WHERE agent_task_id = ? AND state = 'awaiting_approval'
     ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    [taskId]
  );
  const pending = parseStoredApproval(run?.approval ?? null);
  if (!run?.external_run_id || !pending) throw new RuntimeActionError(409, "There is no pending approval to resolve.");
  // The decision must be about the request the user was shown, not a newer one.
  if (pending.requestId && pending.requestId !== requestId) {
    throw new RuntimeActionError(409, "That approval request is out of date. Refresh to see the current one.");
  }

  const { runtime, hermes } = requireRuntime(deps);
  if (runtime !== "hermes" || !hermes) {
    throw new RuntimeActionError(503, "This task runs on a Hermes agent, but this server is not configured for Hermes.");
  }
  try {
    await hermes.resolveApproval(run.external_run_id, choice, pending.requestId);
  } catch (error) {
    if (error instanceof RuntimeError && (error.kind === "conflict" || error.kind === "not_found")) {
      await reconcileTask(taskId, deps);
      throw new RuntimeActionError(409, error.message);
    }
    throw new RuntimeActionError(502, error instanceof RuntimeError ? error.message : "The Hermes agent could not be reached.");
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

/** The user's reply to an output: on Hermes, the next turn of the same conversation. */
export async function requestRevision(
  taskId: string,
  userId: string,
  feedback: string,
  deps: RuntimeDeps = {}
): Promise<DispatchOutcome> {
  const task = await getTaskForUser(taskId, userId);
  if (!task) throw new RuntimeActionError(404, "Task not found");

  const state = stateOf(task);
  const reviewable =
    task.status === "awaiting_review" ||
    task.status === "revision_requested" ||
    (state !== null && ["failed", "cancelled", "needs_review"].includes(state) && (task.current_version ?? 0) > 0);
  if (!reviewable || (state && ["dispatching", "running", "awaiting_approval", "awaiting_input", "cancelling", "queued"].includes(state))) {
    throw new RuntimeActionError(400, "Task not available for revision");
  }
  if ((task.current_version ?? 0) >= (task.max_revisions ?? 5)) {
    throw new RuntimeActionError(400, "Maximum revisions reached");
  }

  await db.execute({
    sql: `INSERT INTO agent_task_feedback (agent_task_id, output_version, feedback_type, feedback_text)
          VALUES (?, ?, 'request_edit', ?)`,
    args: [taskId, task.current_version ?? 0, feedback],
  });

  // A historical task joins the lifecycle the moment the user asks for more.
  await db.execute({
    sql: `UPDATE agent_tasks
          SET runtime_state = COALESCE(runtime_state, 'awaiting_review'),
              runtime_session_id = COALESCE(runtime_session_id, 'brain-portal-task-' || id)
          WHERE id = ?`,
    args: [taskId],
  });

  const current = stateOf((await getTask(taskId))!) ?? "awaiting_review";
  const { config, runtime } = resolve(deps);
  const ready = !!runtime;
  if (!(await transition(taskId, [current], ready ? "queued" : "needs_dispatch", { lastError: ready ? null : config.reason }))) {
    throw new RuntimeActionError(409, "The task changed state; refresh and try again.");
  }
  await recordEvent(taskId, userId, "user", "revision_requested", { version: task.current_version ?? 0 });
  return ready ? dispatchSoon(taskId, deps) : "not_configured";
}

/** Review decisions keep `runtime_state` truthful alongside the coarse status. */
export async function recordReviewDecision(
  taskId: string,
  userId: string,
  decision: "approved" | "rejected",
  reason: string | null = null
): Promise<void> {
  const task = await getTaskForUser(taskId, userId);
  if (!task || !task.runtime_state) return;
  const to: TaskState = decision === "approved" ? "completed" : "rejected";
  await db.execute({
    sql: "UPDATE agent_tasks SET runtime_state = ? WHERE id = ? AND runtime_state IS NOT NULL",
    args: [to, taskId],
  });
  await recordEvent(taskId, userId, "user", decision === "approved" ? "review_approved" : "review_rejected", reason ? { reason: reason.slice(0, 500) } : null);
}

// ── The queue pass (cron) ────────────────────────────────────────────────────

export interface QueuePassReport {
  runtime: RuntimeName | null;
  configured: boolean;
  adopted: number;
  requeued: number;
  dispatched: number;
  completed: number;
  retried: number;
  polled: number;
  failed: number;
  unreachable: number;
  deferred: boolean;
}

export async function runQueuePass(
  deps: RuntimeDeps = {},
  options: { budgetMs?: number; dispatchBatch?: number; pollBatch?: number } = {}
): Promise<QueuePassReport> {
  const started = Date.now();
  const budget = options.budgetMs ?? 240_000;
  const overBudget = () => Date.now() - started > budget;
  const resolved = resolve(deps);
  const { config, runtime, hermes } = resolved;
  const bound: RuntimeDeps = { ...deps, config, hermes: hermes ?? undefined };

  const report: QueuePassReport = {
    runtime,
    configured: !!runtime,
    adopted: await adoptNewTasks(config),
    requeued: 0,
    dispatched: 0,
    completed: 0,
    retried: 0,
    polled: 0,
    failed: 0,
    unreachable: 0,
    deferred: false,
  };

  // Delegation off or misconfigured: nothing is sent and nothing is polled.
  // Work stays where it is, visibly, until a runtime is configured.
  if (!runtime) return report;

  if (runtime === "openrouter") report.requeued = await recoverOpenRouterWork();

  // OpenRouter runs synchronously inside this pass, so take fewer per run.
  const queued = await queryAll<{ id: string }>(
    `SELECT id FROM agent_tasks WHERE runtime_state = 'queued' ORDER BY created_at ASC LIMIT ?`,
    [options.dispatchBatch ?? (runtime === "openrouter" ? 3 : 5)]
  );
  for (const { id } of queued) {
    if (overBudget()) { report.deferred = true; break; }
    const outcome = await dispatchTask(id, bound);
    if (outcome === "dispatched") report.dispatched++;
    if (outcome === "completed") report.completed++;
    if (outcome === "failed") report.failed++;
  }

  if (runtime !== "hermes" || !hermes) return report;

  const dispatching = await queryAll<ManagedTaskRow>(
    `SELECT * FROM agent_tasks WHERE runtime = 'hermes' AND runtime_state = 'dispatching'
     ORDER BY updated_at ASC LIMIT 10`
  );
  for (const task of dispatching) {
    if (overBudget()) { report.deferred = true; break; }
    const outcome = await retryHermesDispatching(task, hermes);
    if (outcome !== "waiting") report.retried++;
    if (outcome === "failed") report.failed++;
    if (outcome === "retrying" && (await getTask(task.id))?.runtime_state === "queued") {
      if ((await dispatchTask(task.id, bound)) === "dispatched") report.dispatched++;
    }
  }

  const active = await queryAll<{ id: string }>(
    `SELECT at.id FROM agent_tasks at
     LEFT JOIN agent_task_runs r ON r.id = (
       SELECT id FROM agent_task_runs WHERE agent_task_id = at.id ORDER BY created_at DESC, rowid DESC LIMIT 1)
     WHERE at.runtime = 'hermes' AND at.runtime_state IN (${POLLED_STATES.map(() => "?").join(", ")})
     ORDER BY COALESCE(r.last_polled_at, '') ASC LIMIT ?`,
    [...POLLED_STATES, options.pollBatch ?? 25]
  );
  for (const { id } of active) {
    if (overBudget()) { report.deferred = true; break; }
    const outcome = await reconcileTask(id, bound);
    report.polled++;
    if (outcome === "completed") report.completed++;
    if (outcome === "failed") report.failed++;
    if (outcome === "unreachable") report.unreachable++;
  }

  return report;
}
