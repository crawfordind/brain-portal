/**
 * The delegated-task dispatcher against a real in-memory database, with a
 * fake Hermes and a fake OpenRouter completion.
 *
 * What these pin down: one submission per task however many workers race,
 * retries that reuse the same idempotency key and bytes, exactly one output
 * version per completed run, truthful states when the runtime is slow,
 * unreachable, forgetful or paused for approval, no network call at all while
 * delegation is not configured, and no fallback between runtimes in either
 * direction.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

const { testDb } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createClient } = require("@libsql/client");
  return { testDb: createClient({ url: ":memory:" }) };
});

vi.mock("@/lib/db/client", () => {
  const run = async (sql: string, args: unknown[] = []) =>
    (await testDb.execute({ sql, args })).rows.map((r: Record<string, unknown>) => ({ ...r }));
  return {
    db: testDb,
    query: run,
    queryAll: run,
    queryOne: async (sql: string, args: unknown[] = []) => (await run(sql, args))[0] ?? null,
    mutate: async (sql: string, args: unknown[] = []) => (await run(sql, args))[0] ?? null,
  };
});

// Any real OpenRouter call fails the test. The OpenRouter runtime is driven
// through an injected completion instead, so a call that reaches this module
// is always a fallback nobody configured.
vi.mock("@/lib/ai/client", () => ({
  complete: vi.fn(() => { throw new Error("OpenRouter called"); }),
  completeWithMeta: vi.fn(() => { throw new Error("OpenRouter called"); }),
  completeJSON: vi.fn(() => { throw new Error("OpenRouter called"); }),
}));
vi.mock("@/lib/ai/models", () => ({
  getModelChain: vi.fn(async () => ["test/model", "openrouter/auto"]),
}));
vi.mock("@/lib/ai/embeddings", () => ({
  findSimilarToText: vi.fn(() => { throw new Error("OpenRouter embeddings called"); }),
  generateEmbedding: vi.fn(() => { throw new Error("OpenRouter embeddings called"); }),
}));

import { RuntimeError } from "@/lib/agents/runtime/hermes-client";
import {
  RuntimeActionError,
  MAX_DISPATCH_ATTEMPTS,
  cancelTask,
  createDelegatedTask,
  dispatchTask,
  reconcileTask,
  recordReviewDecision,
  requestRevision,
  resolveApproval,
  runQueuePass,
  sendTask,
  type CreateTaskInput,
} from "@/lib/agents/runtime/dispatcher";
import * as aiClient from "@/lib/ai/client";
import { DISABLED, OPENROUTER_READY, READY, FakeHermesClient, age, applySchema, fakeComplete, resetData } from "../../../helpers/agent-runtime";

type Row = Record<string, unknown>;
const one = async (sql: string, args: unknown[] = []): Promise<Row> =>
  ({ ...(await testDb.execute({ sql, args })).rows[0] });
const all = async (sql: string, args: unknown[] = []): Promise<Row[]> =>
  (await testDb.execute({ sql, args })).rows.map((r: Row) => ({ ...r }));

const base: CreateTaskInput = {
  userId: "u1",
  title: "Draft the supplier email",
  description: "Draft a reply to the supplier about the late delivery.",
  taskType: "general",
  assignedAgent: "general",
  priority: "medium",
  outputFormat: "markdown",
  contextNoteIds: [],
  contextUrls: [],
  projectId: null,
  sourceType: "task",
  sourceId: null,
  linkTaskId: null,
};

let hermes: FakeHermesClient;
const deps = () => ({ config: READY, hermes: hermes });

beforeAll(async () => {
  await applySchema(testDb);
});

beforeEach(async () => {
  await resetData(testDb);
  hermes = new FakeHermesClient();
  vi.mocked(aiClient.complete).mockClear();
  vi.mocked(aiClient.completeWithMeta).mockClear();
});

async function taskRow(id: string) {
  return one("SELECT * FROM agent_tasks WHERE id = ?", [id]);
}

async function createRunning() {
  const { task } = await createDelegatedTask(base, deps());
  const run = await one("SELECT * FROM agent_task_runs WHERE agent_task_id = ?", [task.id]);
  return { task, run, hermesRunId: String(run.external_run_id) };
}

describe("creating and dispatching", () => {
  it("parks new work as 'not sent' and makes no call when delegation is not configured", async () => {
    const { task, outcome } = await createDelegatedTask(base, { config: DISABLED, hermes: hermes });

    expect(outcome).toBe("not_configured");
    expect(task.runtime_state).toBe("needs_dispatch");
    expect(task.status).toBe("queued");
    expect(task.last_error).toMatch(/AGENT_RUNTIME=off/);
    expect(hermes.totalCalls).toBe(0);
  });

  it("dispatches to Hermes with one session per task and records the run before calling", async () => {
    const { task, outcome } = await createDelegatedTask(base, deps());

    expect(outcome).toBe("dispatched");
    expect(hermes.createCalls).toHaveLength(1);
    const call = hermes.createCalls[0];
    expect(call.body.session_id).toBe(`brain-portal-task-${task.id}`);
    expect(call.body.input).toContain("Draft a reply to the supplier");
    expect(call.body.instructions).toMatch(/Proposed changes/);

    const row = await taskRow(task.id);
    expect(row).toMatchObject({ runtime: "hermes", runtime_state: "running", status: "processing" });

    const run = await one("SELECT * FROM agent_task_runs WHERE agent_task_id = ?", [task.id]);
    expect(run).toMatchObject({ state: "running", external_run_id: "run_1", kind: "initial" });
    expect(run.idempotency_key).toBe(call.key);
    expect(JSON.parse(String(run.request_body))).toEqual(call.body);
  });

  it("lets exactly one of several racing workers submit a task", async () => {
    const { task } = await createDelegatedTask(base, { config: DISABLED, hermes: hermes });
    await testDb.execute({ sql: "UPDATE agent_tasks SET runtime_state = 'queued' WHERE id = ?", args: [task.id] });

    const outcomes = await Promise.all([
      dispatchTask(task.id, deps()),
      dispatchTask(task.id, deps()),
      dispatchTask(task.id, deps()),
    ]);

    expect(outcomes.filter((o) => o === "dispatched")).toHaveLength(1);
    expect(outcomes.filter((o) => o === "not_claimed")).toHaveLength(2);
    expect(hermes.createCalls).toHaveLength(1);
    expect((await all("SELECT id FROM agent_task_runs"))).toHaveLength(1);
  });

  it("links a source task so its status follows the delegation, without stealing an existing link", async () => {
    await testDb.execute(`INSERT INTO tasks (id, user_id, content, title, status) VALUES ('t1', 'u1', 'Call supplier', 'Call supplier', 'pending')`);
    const { task } = await createDelegatedTask({ ...base, sourceType: "task", sourceId: "t1", linkTaskId: "t1" }, deps());

    const linked = await one("SELECT agent_task_id, status FROM tasks WHERE id = 't1'");
    expect(linked.agent_task_id).toBe(task.id);
    expect(linked.status).toBe("in_progress");

    const { task: second } = await createDelegatedTask({ ...base, sourceType: "task", sourceId: "t1", linkTaskId: "t1" }, deps());
    expect((await one("SELECT agent_task_id FROM tasks WHERE id = 't1'")).agent_task_id).toBe(task.id);
    expect(second.id).not.toBe(task.id);
  });
});

describe("submission retries", () => {
  it("retries an unanswered submission with the same key and the same bytes", async () => {
    hermes.createQueue.push(new RuntimeError("timeout", "The Hermes agent did not answer within 15s."));
    const { task, outcome } = await createDelegatedTask(base, deps());

    expect(outcome).toBe("retrying");
    expect((await taskRow(task.id)).runtime_state).toBe("dispatching");
    expect(String((await taskRow(task.id)).last_error)).toMatch(/Retrying automatically/);

    // Not yet due: the backoff holds the retry back.
    await runQueuePass(deps());
    expect(hermes.createCalls).toHaveLength(1);

    await age(testDb, "agent_task_runs", 5);
    await runQueuePass(deps());

    expect(hermes.createCalls).toHaveLength(2);
    expect(hermes.createCalls[1].key).toBe(hermes.createCalls[0].key);
    expect(hermes.createCalls[1].body).toEqual(hermes.createCalls[0].body);
    expect((await taskRow(task.id)).runtime_state).toBe("running");
    expect((await taskRow(task.id)).last_error).toBeNull();
  });

  it("gives up after the retry budget, keeps the key, and a manual Retry re-sends under it", async () => {
    for (let i = 0; i < MAX_DISPATCH_ATTEMPTS; i++) {
      hermes.createQueue.push(new RuntimeError("unreachable", "The Hermes agent could not be reached."));
    }
    const { task } = await createDelegatedTask(base, deps());
    for (let i = 1; i < MAX_DISPATCH_ATTEMPTS; i++) {
      await age(testDb, "agent_task_runs", 30);
      await runQueuePass(deps());
    }

    const failed = await taskRow(task.id);
    expect(failed.runtime_state).toBe("failed");
    expect(String(failed.last_error)).toMatch(/could not be reached after 6 attempts/);
    const abandoned = await one("SELECT * FROM agent_task_runs WHERE agent_task_id = ?", [task.id]);
    expect(abandoned.state).toBe("abandoned");

    const firstKey = hermes.createCalls[0].key;
    expect(await sendTask(task.id, "u1", deps())).toBe("dispatched");
    expect(hermes.createCalls.at(-1)!.key).toBe(firstKey);
    expect((await all("SELECT id FROM agent_task_runs WHERE agent_task_id = ?", [task.id]))).toHaveLength(1);
  });

  it("fails at once, without retrying, when Hermes rejects the credentials", async () => {
    hermes.createQueue.push(new RuntimeError("auth", "The Hermes agent rejected Brain Portal's credentials. Check HERMES_API_KEY.", 401));
    const { task, outcome } = await createDelegatedTask(base, deps());

    expect(outcome).toBe("failed");
    expect((await taskRow(task.id))).toMatchObject({ runtime_state: "failed", status: "failed" });
    await age(testDb, "agent_task_runs", 60);
    await runQueuePass(deps());
    expect(hermes.createCalls).toHaveLength(1);
  });
});

describe("polling", () => {
  it("stores a completed run's answer exactly once, however many pollers race", async () => {
    const { task, hermesRunId } = await createRunning();
    hermes.setRun(hermesRunId, {
      status: "completed",
      output: "## Draft\n\nHi Sam, thanks for the heads-up about the delay.",
      usage: { input_tokens: 120, output_tokens: 80 },
      runtime: { provider: "openai", model: "gpt-5" },
    });

    const outcomes = await Promise.all([
      reconcileTask(task.id, deps()),
      reconcileTask(task.id, deps()),
      reconcileTask(task.id, deps()),
    ]);
    expect(outcomes.filter((o) => o === "completed")).toHaveLength(1);

    const outputs = await all("SELECT * FROM agent_task_outputs WHERE agent_task_id = ?", [task.id]);
    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toMatchObject({ version_number: 1, model_used: "hermes:openai/gpt-5", tokens_input: 120 });
    expect(outputs[0].summary).toBe("Draft");

    expect(await taskRow(task.id)).toMatchObject({
      runtime_state: "awaiting_review",
      status: "awaiting_review",
      current_version: 1,
    });
    const run = await one("SELECT * FROM agent_task_runs WHERE agent_task_id = ?", [task.id]);
    expect(run).toMatchObject({ state: "completed", output_version: 1 });

    // Later passes change nothing.
    await reconcileTask(task.id, deps());
    expect(await all("SELECT id FROM agent_task_outputs WHERE agent_task_id = ?", [task.id])).toHaveLength(1);
  });

  it("treats a completed run with no visible answer as a failure, not a blank deliverable", async () => {
    const { task, hermesRunId } = await createRunning();
    hermes.setRun(hermesRunId, { status: "completed", output: "   " });

    expect(await reconcileTask(task.id, deps())).toBe("failed");
    expect(await all("SELECT id FROM agent_task_outputs")).toHaveLength(0);
    expect(String((await taskRow(task.id)).last_error)).toMatch(/no visible answer/);
  });

  it("surfaces a pending approval, redacted and allowlisted, once", async () => {
    const { task, hermesRunId } = await createRunning();
    hermes.setRun(hermesRunId, {
      status: "waiting_for_approval",
      approval: {
        request_id: "req-1",
        command: "update_task --id t9 --auth 'Bearer sk-or-v1-abcdefghijklmnop'",
        description: "Mark the supplier task done",
        tool_name: "brain-portal.update_task",
        private_args: { token: "should-not-appear" },
      },
    });

    await reconcileTask(task.id, deps());
    await reconcileTask(task.id, deps());

    expect(await taskRow(task.id)).toMatchObject({ runtime_state: "awaiting_approval", status: "processing" });
    const run = await one("SELECT approval FROM agent_task_runs WHERE agent_task_id = ?", [task.id]);
    const stored = String(run.approval);
    expect(stored).toContain("req-1");
    expect(stored).not.toContain("abcdefghijklmnop");
    expect(stored).not.toContain("should-not-appear");

    const events = await all("SELECT kind FROM agent_task_events WHERE agent_task_id = ? AND kind = 'approval_requested'", [task.id]);
    expect(events).toHaveLength(1);
  });

  it("leaves the state alone and says so when Hermes is unreachable", async () => {
    const { task, hermesRunId } = await createRunning();
    hermes.setRun(hermesRunId, new RuntimeError("unreachable", "The Hermes agent could not be reached."));

    expect(await reconcileTask(task.id, deps())).toBe("unreachable");
    const row = await taskRow(task.id);
    expect(row.runtime_state).toBe("running");
    expect(String(row.last_error)).toMatch(/Hermes agent unreachable since .* status is unknown/);
    expect((await one("SELECT unreachable_since FROM agent_task_runs")).unreachable_since).not.toBeNull();
    expect(await all("SELECT id FROM agent_task_outputs")).toHaveLength(0);

    // Hermes comes back: the note clears.
    hermes.setRun(hermesRunId, { status: "running" });
    await reconcileTask(task.id, deps());
    expect((await taskRow(task.id)).last_error).toBeNull();
    expect((await one("SELECT unreachable_since FROM agent_task_runs")).unreachable_since).toBeNull();
  });

  it("marks a run Hermes has forgotten as failed, never inventing an output", async () => {
    const { task, hermesRunId } = await createRunning();
    hermes.runs.delete(hermesRunId);

    expect(await reconcileTask(task.id, deps())).toBe("failed");
    expect((await one("SELECT state FROM agent_task_runs")).state).toBe("lost");
    expect(String((await taskRow(task.id)).last_error)).toMatch(/no longer has a record/);
    expect(await all("SELECT id FROM agent_task_outputs")).toHaveLength(0);
  });

  it("does not retry an interrupted run on its own: it may have done part of the work", async () => {
    const { task, hermesRunId } = await createRunning();
    hermes.setRun(hermesRunId, { status: "interrupted", error: "Gateway shutdown interrupted the run." });

    await reconcileTask(task.id, deps());
    expect(await taskRow(task.id)).toMatchObject({ runtime_state: "failed", status: "failed" });
    expect((await one("SELECT state FROM agent_task_runs")).state).toBe("interrupted");

    await age(testDb, "agent_tasks", 120);
    await runQueuePass(deps());
    expect(hermes.createCalls).toHaveLength(1);
  });

  it("is throttled for UI-triggered polls", async () => {
    const { task } = await createRunning();
    await reconcileTask(task.id, deps());
    expect(await reconcileTask(task.id, deps(), { minIntervalMs: 60_000 })).toBe("skipped");
    expect(hermes.getCalls).toHaveLength(1);
  });
});

describe("approvals", () => {
  async function paused() {
    const { task, hermesRunId } = await createRunning();
    hermes.setRun(hermesRunId, {
      status: "waiting_for_approval",
      approval: { request_id: "req-7", command: "create_note", description: "Save the draft as a note" },
    });
    await reconcileTask(task.id, deps());
    return { task, hermesRunId };
  }

  it("forwards the user's decision for the exact request shown, and records it", async () => {
    const { task, hermesRunId } = await paused();
    await resolveApproval(task.id, "u1", "once", "req-7", deps());

    expect(hermes.approvalCalls).toEqual([{ runId: hermesRunId, choice: "once", requestId: "req-7" }]);
    expect((await taskRow(task.id)).runtime_state).toBe("running");
    const event = await one("SELECT * FROM agent_task_events WHERE kind = 'approval_decided'");
    expect(event.actor).toBe("user");
    expect(JSON.parse(String(event.detail))).toMatchObject({ choice: "once", request_id: "req-7" });
  });

  it("refuses a stale request id, another user's task, and a task that is not paused", async () => {
    const { task } = await paused();
    await expect(resolveApproval(task.id, "u1", "once", "req-OLD", deps())).rejects.toMatchObject({ status: 409 });
    await expect(resolveApproval(task.id, "u2", "once", "req-7", deps())).rejects.toMatchObject({ status: 404 });
    expect(hermes.approvalCalls).toHaveLength(0);

    const { task: other } = await createRunning();
    await expect(resolveApproval(other.id, "u1", "deny", null, deps())).rejects.toMatchObject({ status: 409 });
  });

  it("reconciles when Hermes says the approval was already resolved", async () => {
    const { task, hermesRunId } = await paused();
    hermes.approvalQueue.push(new RuntimeError("conflict", "That approval has already been resolved or expired.", 409, "approval_not_pending"));
    hermes.setRun(hermesRunId, { status: "running" });

    await expect(resolveApproval(task.id, "u1", "deny", "req-7", deps())).rejects.toBeInstanceOf(RuntimeActionError);
    expect((await taskRow(task.id)).runtime_state).toBe("running");
  });
});

describe("cancelling", () => {
  it("cancels work Hermes never had without asking it", async () => {
    const { task } = await createDelegatedTask(base, { config: DISABLED, hermes: hermes });
    expect(await cancelTask(task.id, "u1", deps())).toBe("cancelled");
    expect(await taskRow(task.id)).toMatchObject({ runtime_state: "cancelled", status: "rejected" });
    expect(hermes.totalCalls).toBe(0);
  });

  it("asks Hermes to stop, says 'stopping' until it confirms, then 'cancelled'", async () => {
    const { task, hermesRunId } = await createRunning();
    expect(await cancelTask(task.id, "u1", deps())).toBe("cancelling");
    expect(hermes.stopCalls).toEqual([hermesRunId]);
    expect((await taskRow(task.id)).runtime_state).toBe("cancelling");

    hermes.setRun(hermesRunId, { status: "stopping" });
    await reconcileTask(task.id, deps());
    expect((await taskRow(task.id)).runtime_state).toBe("cancelling");

    hermes.setRun(hermesRunId, { status: "cancelled" });
    await reconcileTask(task.id, deps());
    expect(await taskRow(task.id)).toMatchObject({ runtime_state: "cancelled", status: "rejected" });
  });

  it("keeps an answer that landed before the stop took effect", async () => {
    const { task, hermesRunId } = await createRunning();
    await cancelTask(task.id, "u1", deps());
    hermes.setRun(hermesRunId, { status: "completed", output: "Finished anyway." });
    await reconcileTask(task.id, deps());
    expect((await taskRow(task.id)).runtime_state).toBe("awaiting_review");
    expect(await all("SELECT id FROM agent_task_outputs")).toHaveLength(1);
  });

  it("refuses while the submission itself is in flight, and for other users", async () => {
    hermes.createQueue.push(new RuntimeError("timeout", "The Hermes agent did not answer within 15s."));
    const { task } = await createDelegatedTask(base, deps());
    await expect(cancelTask(task.id, "u1", deps())).rejects.toMatchObject({ status: 409 });
    await expect(cancelTask(task.id, "u2", deps())).rejects.toMatchObject({ status: 404 });
  });
});

describe("review and revision continuity", () => {
  async function reviewed() {
    const { task, hermesRunId } = await createRunning();
    hermes.setRun(hermesRunId, { status: "completed", output: "Version one." });
    await reconcileTask(task.id, deps());
    return task;
  }

  it("sends a revision as the next turn of the same Hermes session, with the feedback and previous version", async () => {
    const task = await reviewed();
    expect(await requestRevision(task.id, "u1", "Shorter, and mention the new date.", deps())).toBe("dispatched");

    const second = hermes.createCalls[1];
    expect(second.body.session_id).toBe(hermes.createCalls[0].body.session_id);
    expect(second.body.input).toContain("Shorter, and mention the new date.");
    expect(second.body.input).toContain("Version one.");
    expect(second.key).not.toBe(hermes.createCalls[0].key);
    expect((await one("SELECT kind FROM agent_task_runs ORDER BY created_at DESC, rowid DESC LIMIT 1")).kind).toBe("revision");

    hermes.setRun("run_2", { status: "completed", output: "Version two." });
    await reconcileTask(task.id, deps());
    const versions = await all("SELECT version_number, content FROM agent_task_outputs ORDER BY version_number");
    expect(versions.map((v) => v.content)).toEqual(["Version one.", "Version two."]);
    expect((await taskRow(task.id)).current_version).toBe(2);
  });

  it("keeps the earlier version reviewable when a revision fails", async () => {
    const task = await reviewed();
    await requestRevision(task.id, "u1", "Try again", deps());
    hermes.setRun("run_2", { status: "failed", error: "max_iterations_reached(60/60)" });
    await reconcileTask(task.id, deps());
    expect(await taskRow(task.id)).toMatchObject({ runtime_state: "failed", status: "awaiting_review", current_version: 1 });
  });

  it("records review decisions alongside the coarse status", async () => {
    const task = await reviewed();
    await testDb.execute({ sql: "UPDATE agent_tasks SET status = 'approved' WHERE id = ?", args: [task.id] });
    await recordReviewDecision(task.id, "u1", "approved");
    expect((await taskRow(task.id)).runtime_state).toBe("completed");
    expect((await one("SELECT actor, kind FROM agent_task_events WHERE kind = 'review_approved'")).actor).toBe("user");
  });

  it("turns a historical OpenRouter task into a Hermes task when the user asks for a revision", async () => {
    await testDb.execute(`INSERT INTO agent_tasks (id, user_id, title, description, task_type, assigned_agent, status, current_version)
                          VALUES ('legacy1', 'u1', 'Old', 'Old instruction', 'general', 'general', 'awaiting_review', 1)`);
    await testDb.execute(`INSERT INTO agent_task_outputs (agent_task_id, version_number, content, model_used)
                          VALUES ('legacy1', 1, 'Old OpenRouter answer', 'minimax/minimax-m2.7')`);

    expect(await requestRevision("legacy1", "u1", "Update this", deps())).toBe("dispatched");
    expect(await taskRow("legacy1")).toMatchObject({ runtime: "hermes", runtime_state: "running" });
    expect(hermes.createCalls[0].body.input).toContain("Old OpenRouter answer");
    // History stays readable and untouched.
    expect((await one("SELECT model_used FROM agent_task_outputs WHERE agent_task_id = 'legacy1'")).model_used).toBe("minimax/minimax-m2.7");
  });

  it("refuses a revision while the agent is still working", async () => {
    const { task } = await createRunning();
    await expect(requestRevision(task.id, "u1", "x", deps())).rejects.toMatchObject({ status: 400 });
  });
});

describe("the queue pass", () => {
  it("adopts rows written by MCP, heartbeat or skills and sends them to the runtime", async () => {
    await testDb.execute(`INSERT INTO agent_tasks (id, user_id, title, description, task_type, assigned_agent, status)
                          VALUES ('mcp1', 'u1', 'From MCP', 'Research the venue', 'research', 'research', 'queued')`);
    const report = await runQueuePass(deps());
    expect(report).toMatchObject({ adopted: 1, dispatched: 1 });
    expect(await taskRow("mcp1")).toMatchObject({ runtime: "hermes", runtime_state: "running" });
  });

  it("with delegation off: adopts as 'not sent' and makes no call, even for runs in flight", async () => {
    const { task } = await createRunning();
    await testDb.execute(`INSERT INTO agent_tasks (id, user_id, title, description, task_type, assigned_agent, status)
                          VALUES ('mcp2', 'u1', 'From MCP', 'Research', 'research', 'research', 'queued')`);
    const before = hermes.totalCalls;

    const report = await runQueuePass({ config: DISABLED, hermes: hermes });
    expect(report.configured).toBe(false);
    expect(hermes.totalCalls).toBe(before);
    expect((await taskRow("mcp2")).runtime_state).toBe("needs_dispatch");
    expect((await taskRow(task.id)).runtime_state).toBe("running");
  });

  it("puts a claim whose run row was never written back in the queue", async () => {
    await testDb.execute(`INSERT INTO agent_tasks (id, user_id, title, description, task_type, assigned_agent, status, runtime, runtime_state)
                          VALUES ('crash1', 'u1', 'Crashed', 'Do it', 'general', 'general', 'processing', 'hermes', 'dispatching')`);
    await age(testDb, "agent_tasks", 5);
    await runQueuePass(deps());
    expect((await taskRow("crash1")).runtime_state).toBe("running");
    expect(hermes.createCalls).toHaveLength(1);
  });
});

describe("sending and ownership", () => {
  it("sends parked work only on request, and only the owner can", async () => {
    const { task } = await createDelegatedTask(base, { config: DISABLED, hermes: hermes });
    await runQueuePass(deps());
    expect(hermes.createCalls).toHaveLength(0);

    await expect(sendTask(task.id, "u2", deps())).rejects.toMatchObject({ status: 404 });
    expect(await sendTask(task.id, "u1", deps())).toBe("dispatched");
  });

  it("refuses to send while delegation is not configured, without changing anything", async () => {
    const { task } = await createDelegatedTask(base, { config: DISABLED, hermes: hermes });
    await expect(sendTask(task.id, "u1", { config: DISABLED })).rejects.toMatchObject({ status: 503 });
    expect((await taskRow(task.id)).runtime_state).toBe("needs_dispatch");
  });

  it("never puts another user's note in the agent's context, even if its id was stored", async () => {
    await testDb.execute(`INSERT INTO notes (id, user_id, title, slug, content, content_plain)
                          VALUES ('mine', 'u1', 'Mine', 'mine', 'my private plan', 'my private plan'),
                                 ('theirs', 'u2', 'Theirs', 'theirs', 'SOMEONE ELSES SECRET', 'SOMEONE ELSES SECRET')`);
    await createDelegatedTask({ ...base, contextNoteIds: ["mine", "theirs"] }, deps());
    const input = hermes.createCalls[0].body.input;
    expect(input).toContain("my private plan");
    expect(input).not.toContain("SOMEONE ELSES SECRET");
  });
});

describe("no fallback: Hermes never spends OpenRouter credits", () => {
  it("runs a full create → approval → revise → complete cycle without one OpenRouter call", async () => {
    const { task, hermesRunId } = await createRunning();
    hermes.setRun(hermesRunId, { status: "waiting_for_approval", approval: { request_id: "r", description: "x" } });
    await reconcileTask(task.id, deps());
    await resolveApproval(task.id, "u1", "deny", "r", deps());
    hermes.setRun(hermesRunId, { status: "completed", output: "Done." });
    await reconcileTask(task.id, deps());
    await requestRevision(task.id, "u1", "More detail", deps());
    hermes.setRun("run_2", { status: "completed", output: "Done, in detail." });
    await runQueuePass(deps());

    expect(aiClient.complete).not.toHaveBeenCalled();
    expect(aiClient.completeWithMeta).not.toHaveBeenCalled();
    expect((await taskRow(task.id)).current_version).toBe(2);
  });
});

describe("the OpenRouter runtime", () => {
  const openrouter = (complete = fakeComplete().fn) => ({ config: OPENROUTER_READY, hermes, complete });

  it("runs the task in one model call and stores the answer as version 1", async () => {
    const model = fakeComplete(["## Reply\n\nHi Sam, thanks for the update."]);
    const { task, outcome } = await createDelegatedTask(base, openrouter(model.fn));

    expect(outcome).toBe("completed");
    expect(model.calls).toHaveLength(1);
    expect(model.calls[0].prompt).toContain("Draft a reply to the supplier");
    expect(String(model.calls[0].options.system)).toMatch(/You have no tools/);
    expect(model.calls[0].options.models).toEqual(["test/model", "openrouter/auto"]);

    expect(await taskRow(task.id)).toMatchObject({
      runtime: "openrouter",
      runtime_state: "awaiting_review",
      status: "awaiting_review",
      current_version: 1,
    });
    const output = await one("SELECT * FROM agent_task_outputs WHERE agent_task_id = ?", [task.id]);
    expect(output).toMatchObject({ version_number: 1, model_used: "test/model", summary: "Reply" });
    const run = await one("SELECT * FROM agent_task_runs WHERE agent_task_id = ?", [task.id]);
    expect(run).toMatchObject({ runtime: "openrouter", state: "completed", output_version: 1, external_run_id: null });
  });

  it("uses the agent type's persona and pinned model when one is configured", async () => {
    await testDb.execute(`DELETE FROM agent_configs`);
    await testDb.execute(`INSERT INTO agent_configs (agent_type, display_name, description, system_prompt, model_id)
                          VALUES ('legal', 'Legal', 'Contracts', 'You review contracts carefully.', 'pinned/model')`);
    const model = fakeComplete();
    await createDelegatedTask({ ...base, assignedAgent: "legal", taskType: "legal" }, openrouter(model.fn));

    expect(String(model.calls[0].options.system)).toMatch(/^You review contracts carefully\./);
    expect(model.calls[0].options.models).toEqual(["pinned/model", "test/model", "openrouter/auto"]);
    await testDb.execute(`DELETE FROM agent_configs`);
  });

  it("retries an empty answer once with a bigger budget, then fails rather than storing a blank version", async () => {
    const model = fakeComplete([{ content: "", finishReason: "length" }, { content: "", finishReason: "length" }]);
    const { task, outcome } = await createDelegatedTask(base, openrouter(model.fn));

    expect(outcome).toBe("failed");
    expect(model.calls).toHaveLength(2);
    expect(Number(model.calls[1].options.maxTokens)).toBeGreaterThan(Number(model.calls[0].options.maxTokens));
    expect(await all("SELECT id FROM agent_task_outputs")).toHaveLength(0);
    expect(String((await taskRow(task.id)).last_error)).toMatch(/empty response/);
  });

  it("retries a failed model call automatically after a backoff, within the retry budget", async () => {
    const model = fakeComplete([new Error("402 Insufficient credits"), "Second time lucky."]);
    const { task, outcome } = await createDelegatedTask(base, openrouter(model.fn));
    expect(outcome).toBe("failed");
    expect(await taskRow(task.id)).toMatchObject({ runtime_state: "failed", retry_count: 1 });
    expect(String((await taskRow(task.id)).last_error)).toMatch(/402 Insufficient credits/);

    // Not yet due.
    await runQueuePass(openrouter(model.fn));
    expect(model.calls).toHaveLength(1);

    await age(testDb, "agent_tasks", 6);
    const report = await runQueuePass(openrouter(model.fn));
    expect(report).toMatchObject({ runtime: "openrouter", requeued: 1, completed: 1 });
    expect(model.calls).toHaveLength(2);
    expect((await taskRow(task.id)).runtime_state).toBe("awaiting_review");
  });

  it("stops retrying once the budget is spent", async () => {
    const model = fakeComplete([new Error("500"), new Error("500"), new Error("500"), new Error("500")]);
    const { task } = await createDelegatedTask(base, openrouter(model.fn));
    for (let i = 0; i < 4; i++) {
      await age(testDb, "agent_tasks", 6);
      await runQueuePass(openrouter(model.fn));
    }
    expect(model.calls).toHaveLength(3);
    expect(await taskRow(task.id)).toMatchObject({ runtime_state: "failed", retry_count: 3 });
  });

  it("re-queues a run that died with its worker, and stores exactly one answer", async () => {
    const { task } = await createDelegatedTask(base, { config: DISABLED, hermes });
    // A worker claimed the task, recorded the run, then was killed mid-call.
    await testDb.execute({
      sql: `UPDATE agent_tasks SET runtime = 'openrouter', runtime_state = 'running', status = 'processing' WHERE id = ?`,
      args: [task.id],
    });
    await testDb.execute({
      sql: `INSERT INTO agent_task_runs (id, agent_task_id, user_id, runtime, kind, idempotency_key, request_body, state)
            VALUES ('dead', ?, 'u1', 'openrouter', 'initial', 'k-dead', '{"input":"x","instructions":"y"}', 'running')`,
      args: [task.id],
    });
    await age(testDb, "agent_task_runs", 11);

    const model = fakeComplete(["Recovered."]);
    const report = await runQueuePass(openrouter(model.fn));
    expect(report.requeued).toBe(1);
    expect((await one("SELECT state FROM agent_task_runs WHERE id = 'dead'")).state).toBe("abandoned");
    expect(await all("SELECT content FROM agent_task_outputs WHERE agent_task_id = ?", [task.id])).toEqual([{ content: "Recovered." }]);
  });

  it("sends a revision with the previous version and the feedback", async () => {
    const model = fakeComplete(["Version one.", "Version two."]);
    const { task } = await createDelegatedTask(base, openrouter(model.fn));
    expect(await requestRevision(task.id, "u1", "Shorter, please.", openrouter(model.fn))).toBe("completed");

    expect(model.calls[1].prompt).toContain("Version one.");
    expect(model.calls[1].prompt).toContain("Shorter, please.");
    expect(model.calls[1].options.temperature).toBe(0.4);
    const versions = await all("SELECT content FROM agent_task_outputs ORDER BY version_number");
    expect(versions.map((v) => v.content)).toEqual(["Version one.", "Version two."]);
  });

  it("defers the model call when the caller provides a scheduler", async () => {
    const scheduled: Array<() => Promise<unknown>> = [];
    const model = fakeComplete(["Later."]);
    const { task, outcome } = await createDelegatedTask(base, {
      ...openrouter(model.fn),
      schedule: (work) => { scheduled.push(work); },
    });
    expect(outcome).toBe("scheduled");
    expect(model.calls).toHaveLength(0);
    await scheduled[0]();
    expect((await taskRow(task.id)).runtime_state).toBe("awaiting_review");
  });

  it("offers no approvals and cannot interrupt a call in flight", async () => {
    const { task } = await createDelegatedTask(base, { config: DISABLED, hermes });
    await testDb.execute({
      sql: `UPDATE agent_tasks SET runtime = 'openrouter', runtime_state = 'running', status = 'processing' WHERE id = ?`,
      args: [task.id],
    });
    await expect(cancelTask(task.id, "u1", openrouter())).rejects.toMatchObject({ status: 409 });
    await expect(resolveApproval(task.id, "u1", "once", null, openrouter())).rejects.toMatchObject({ status: 409 });
  });
});

describe("no fallback between runtimes", () => {
  it("an OpenRouter deployment never calls Hermes, even with a Hermes client at hand", async () => {
    const model = fakeComplete(["Answer.", "Revised."]);
    const deps = { config: OPENROUTER_READY, hermes, complete: model.fn };
    const { task } = await createDelegatedTask(base, deps);
    await requestRevision(task.id, "u1", "More", deps);
    await testDb.execute(`INSERT INTO agent_tasks (id, user_id, title, description, task_type, assigned_agent, status)
                          VALUES ('mcp3', 'u1', 'From MCP', 'Research', 'research', 'research', 'queued')`);
    await runQueuePass(deps);

    expect(hermes.totalCalls).toBe(0);
    expect(model.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("a Hermes deployment never calls OpenRouter while Hermes is unreachable", async () => {
    const model = fakeComplete();
    for (let i = 0; i < MAX_DISPATCH_ATTEMPTS; i++) {
      hermes.createQueue.push(new RuntimeError("unreachable", "The Hermes agent could not be reached."));
    }
    const deps = { config: READY, hermes, complete: model.fn };
    const { task } = await createDelegatedTask(base, deps);
    for (let i = 1; i < MAX_DISPATCH_ATTEMPTS; i++) {
      await age(testDb, "agent_task_runs", 30);
      await runQueuePass(deps);
    }

    expect((await taskRow(task.id)).runtime_state).toBe("failed");
    expect(model.calls).toHaveLength(0);
    expect(aiClient.completeWithMeta).not.toHaveBeenCalled();
    expect(await all("SELECT id FROM agent_task_outputs")).toHaveLength(0);
  });

  it("a misconfigured Hermes deployment parks work instead of using OpenRouter", async () => {
    const model = fakeComplete();
    const misconfigured = { ...READY, state: "misconfigured" as const, reason: "AGENT_RUNTIME is hermes but HERMES_URL is not set.", hermes: null };
    const { task, outcome } = await createDelegatedTask(base, { config: misconfigured, complete: model.fn });

    expect(outcome).toBe("not_configured");
    expect((await taskRow(task.id)).runtime_state).toBe("needs_dispatch");
    expect(model.calls).toHaveLength(0);
  });
});
