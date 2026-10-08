/**
 * The Jack dispatcher against a real in-memory database and a fake Hermes.
 *
 * What these pin down is the brief's integrity list: one submission per task
 * however many workers race, retries that reuse the same idempotency key and
 * bytes, exactly one output version per completed run, truthful states when
 * Jack is slow, unreachable, forgetful or paused for approval, and no network
 * call at all while Jack is not configured.
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

// The task runtime must never reach OpenRouter, directly or through a helper.
vi.mock("@/lib/ai/client", () => ({
  complete: vi.fn(() => { throw new Error("OpenRouter called"); }),
  completeWithMeta: vi.fn(() => { throw new Error("OpenRouter called"); }),
  completeJSON: vi.fn(() => { throw new Error("OpenRouter called"); }),
}));
vi.mock("@/lib/ai/embeddings", () => ({
  findSimilarToText: vi.fn(() => { throw new Error("OpenRouter embeddings called"); }),
  generateEmbedding: vi.fn(() => { throw new Error("OpenRouter embeddings called"); }),
}));

import { JackError } from "@/lib/agents/jack/client";
import {
  JackActionError,
  MAX_DISPATCH_ATTEMPTS,
  cancelJackTask,
  createJackTask,
  dispatchJackTask,
  reconcileJackTask,
  recordReviewDecision,
  requestJackRevision,
  resolveJackApproval,
  runJackQueuePass,
  sendToJack,
  type CreateJackTaskInput,
} from "@/lib/agents/jack/dispatcher";
import * as aiClient from "@/lib/ai/client";
import { DISABLED, READY, FakeJackClient, age, applySchema, resetData } from "../../../helpers/jack";

type Row = Record<string, unknown>;
const one = async (sql: string, args: unknown[] = []): Promise<Row> =>
  ({ ...(await testDb.execute({ sql, args })).rows[0] });
const all = async (sql: string, args: unknown[] = []): Promise<Row[]> =>
  (await testDb.execute({ sql, args })).rows.map((r: Row) => ({ ...r }));

const base: CreateJackTaskInput = {
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

let jack: FakeJackClient;
const deps = () => ({ config: READY, client: jack });

beforeAll(async () => {
  await applySchema(testDb);
});

beforeEach(async () => {
  await resetData(testDb);
  jack = new FakeJackClient();
  vi.mocked(aiClient.complete).mockClear();
  vi.mocked(aiClient.completeWithMeta).mockClear();
});

async function taskRow(id: string) {
  return one("SELECT * FROM agent_tasks WHERE id = ?", [id]);
}

async function createRunning() {
  const { task } = await createJackTask(base, deps());
  const run = await one("SELECT * FROM agent_task_runs WHERE agent_task_id = ?", [task.id]);
  return { task, run, hermesRunId: String(run.hermes_run_id) };
}

describe("creating and dispatching", () => {
  it("parks new work as 'not sent' and makes no call when Jack is not configured", async () => {
    const { task, outcome } = await createJackTask(base, { config: DISABLED, client: jack });

    expect(outcome).toBe("not_configured");
    expect(task.jack_state).toBe("needs_dispatch");
    expect(task.status).toBe("queued");
    expect(task.last_error).toMatch(/Jack connection not configured/);
    expect(jack.totalCalls).toBe(0);
  });

  it("dispatches to Jack with one session per task and records the run before calling", async () => {
    const { task, outcome } = await createJackTask(base, deps());

    expect(outcome).toBe("dispatched");
    expect(jack.createCalls).toHaveLength(1);
    const call = jack.createCalls[0];
    expect(call.body.session_id).toBe(`brain-portal-task-${task.id}`);
    expect(call.body.input).toContain("Draft a reply to the supplier");
    expect(call.body.instructions).toMatch(/Proposed changes/);

    const row = await taskRow(task.id);
    expect(row).toMatchObject({ runtime: "jack", jack_state: "running", status: "processing" });

    const run = await one("SELECT * FROM agent_task_runs WHERE agent_task_id = ?", [task.id]);
    expect(run).toMatchObject({ state: "running", hermes_run_id: "run_1", kind: "initial" });
    expect(run.idempotency_key).toBe(call.key);
    expect(JSON.parse(String(run.request_body))).toEqual(call.body);
  });

  it("lets exactly one of several racing workers submit a task", async () => {
    const { task } = await createJackTask(base, { config: DISABLED, client: jack });
    await testDb.execute({ sql: "UPDATE agent_tasks SET jack_state = 'queued' WHERE id = ?", args: [task.id] });

    const outcomes = await Promise.all([
      dispatchJackTask(task.id, deps()),
      dispatchJackTask(task.id, deps()),
      dispatchJackTask(task.id, deps()),
    ]);

    expect(outcomes.filter((o) => o === "dispatched")).toHaveLength(1);
    expect(outcomes.filter((o) => o === "not_claimed")).toHaveLength(2);
    expect(jack.createCalls).toHaveLength(1);
    expect((await all("SELECT id FROM agent_task_runs"))).toHaveLength(1);
  });

  it("links a source task so its status follows the delegation, without stealing an existing link", async () => {
    await testDb.execute(`INSERT INTO tasks (id, user_id, content, title, status) VALUES ('t1', 'u1', 'Call supplier', 'Call supplier', 'pending')`);
    const { task } = await createJackTask({ ...base, sourceType: "task", sourceId: "t1", linkTaskId: "t1" }, deps());

    const linked = await one("SELECT agent_task_id, status FROM tasks WHERE id = 't1'");
    expect(linked.agent_task_id).toBe(task.id);
    expect(linked.status).toBe("in_progress");

    const { task: second } = await createJackTask({ ...base, sourceType: "task", sourceId: "t1", linkTaskId: "t1" }, deps());
    expect((await one("SELECT agent_task_id FROM tasks WHERE id = 't1'")).agent_task_id).toBe(task.id);
    expect(second.id).not.toBe(task.id);
  });
});

describe("submission retries", () => {
  it("retries an unanswered submission with the same key and the same bytes", async () => {
    jack.createQueue.push(new JackError("timeout", "Jack did not answer within 15s."));
    const { task, outcome } = await createJackTask(base, deps());

    expect(outcome).toBe("retrying");
    expect((await taskRow(task.id)).jack_state).toBe("dispatching");
    expect(String((await taskRow(task.id)).last_error)).toMatch(/Retrying automatically/);

    // Not yet due: the backoff holds the retry back.
    await runJackQueuePass(deps());
    expect(jack.createCalls).toHaveLength(1);

    await age(testDb, "agent_task_runs", 5);
    await runJackQueuePass(deps());

    expect(jack.createCalls).toHaveLength(2);
    expect(jack.createCalls[1].key).toBe(jack.createCalls[0].key);
    expect(jack.createCalls[1].body).toEqual(jack.createCalls[0].body);
    expect((await taskRow(task.id)).jack_state).toBe("running");
    expect((await taskRow(task.id)).last_error).toBeNull();
  });

  it("gives up after the retry budget, keeps the key, and a manual Retry re-sends under it", async () => {
    for (let i = 0; i < MAX_DISPATCH_ATTEMPTS; i++) {
      jack.createQueue.push(new JackError("unreachable", "Jack could not be reached."));
    }
    const { task } = await createJackTask(base, deps());
    for (let i = 1; i < MAX_DISPATCH_ATTEMPTS; i++) {
      await age(testDb, "agent_task_runs", 30);
      await runJackQueuePass(deps());
    }

    const failed = await taskRow(task.id);
    expect(failed.jack_state).toBe("failed");
    expect(String(failed.last_error)).toMatch(/could not be reached after 6 attempts/);
    const abandoned = await one("SELECT * FROM agent_task_runs WHERE agent_task_id = ?", [task.id]);
    expect(abandoned.state).toBe("abandoned");

    const firstKey = jack.createCalls[0].key;
    expect(await sendToJack(task.id, "u1", deps())).toBe("dispatched");
    expect(jack.createCalls.at(-1)!.key).toBe(firstKey);
    expect((await all("SELECT id FROM agent_task_runs WHERE agent_task_id = ?", [task.id]))).toHaveLength(1);
  });

  it("fails at once, without retrying, when Jack rejects the credentials", async () => {
    jack.createQueue.push(new JackError("auth", "Jack rejected Brain Portal's credentials. Check JACK_HERMES_API_KEY.", 401));
    const { task, outcome } = await createJackTask(base, deps());

    expect(outcome).toBe("failed");
    expect((await taskRow(task.id))).toMatchObject({ jack_state: "failed", status: "failed" });
    await age(testDb, "agent_task_runs", 60);
    await runJackQueuePass(deps());
    expect(jack.createCalls).toHaveLength(1);
  });
});

describe("polling", () => {
  it("stores a completed run's answer exactly once, however many pollers race", async () => {
    const { task, hermesRunId } = await createRunning();
    jack.setRun(hermesRunId, {
      status: "completed",
      output: "## Draft\n\nHi Sam, thanks for the heads-up about the delay.",
      usage: { input_tokens: 120, output_tokens: 80 },
      runtime: { provider: "openai", model: "gpt-5" },
    });

    const outcomes = await Promise.all([
      reconcileJackTask(task.id, deps()),
      reconcileJackTask(task.id, deps()),
      reconcileJackTask(task.id, deps()),
    ]);
    expect(outcomes.filter((o) => o === "completed")).toHaveLength(1);

    const outputs = await all("SELECT * FROM agent_task_outputs WHERE agent_task_id = ?", [task.id]);
    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toMatchObject({ version_number: 1, model_used: "jack:openai/gpt-5", tokens_input: 120 });
    expect(outputs[0].summary).toBe("Draft");

    expect(await taskRow(task.id)).toMatchObject({
      jack_state: "awaiting_review",
      status: "awaiting_review",
      current_version: 1,
    });
    const run = await one("SELECT * FROM agent_task_runs WHERE agent_task_id = ?", [task.id]);
    expect(run).toMatchObject({ state: "completed", output_version: 1 });

    // Later passes change nothing.
    await reconcileJackTask(task.id, deps());
    expect(await all("SELECT id FROM agent_task_outputs WHERE agent_task_id = ?", [task.id])).toHaveLength(1);
  });

  it("treats a completed run with no visible answer as a failure, not a blank deliverable", async () => {
    const { task, hermesRunId } = await createRunning();
    jack.setRun(hermesRunId, { status: "completed", output: "   " });

    expect(await reconcileJackTask(task.id, deps())).toBe("failed");
    expect(await all("SELECT id FROM agent_task_outputs")).toHaveLength(0);
    expect(String((await taskRow(task.id)).last_error)).toMatch(/no visible answer/);
  });

  it("surfaces a pending approval, redacted and allowlisted, once", async () => {
    const { task, hermesRunId } = await createRunning();
    jack.setRun(hermesRunId, {
      status: "waiting_for_approval",
      approval: {
        request_id: "req-1",
        command: "update_task --id t9 --auth 'Bearer sk-or-v1-abcdefghijklmnop'",
        description: "Mark the supplier task done",
        tool_name: "brain-portal.update_task",
        private_args: { token: "should-not-appear" },
      },
    });

    await reconcileJackTask(task.id, deps());
    await reconcileJackTask(task.id, deps());

    expect(await taskRow(task.id)).toMatchObject({ jack_state: "awaiting_approval", status: "processing" });
    const run = await one("SELECT approval FROM agent_task_runs WHERE agent_task_id = ?", [task.id]);
    const stored = String(run.approval);
    expect(stored).toContain("req-1");
    expect(stored).not.toContain("abcdefghijklmnop");
    expect(stored).not.toContain("should-not-appear");

    const events = await all("SELECT kind FROM agent_task_events WHERE agent_task_id = ? AND kind = 'approval_requested'", [task.id]);
    expect(events).toHaveLength(1);
  });

  it("leaves the state alone and says so when Jack is unreachable", async () => {
    const { task, hermesRunId } = await createRunning();
    jack.setRun(hermesRunId, new JackError("unreachable", "Jack could not be reached."));

    expect(await reconcileJackTask(task.id, deps())).toBe("unreachable");
    const row = await taskRow(task.id);
    expect(row.jack_state).toBe("running");
    expect(String(row.last_error)).toMatch(/Jack unreachable since .* status is unknown/);
    expect((await one("SELECT unreachable_since FROM agent_task_runs")).unreachable_since).not.toBeNull();
    expect(await all("SELECT id FROM agent_task_outputs")).toHaveLength(0);

    // Jack comes back: the note clears.
    jack.setRun(hermesRunId, { status: "running" });
    await reconcileJackTask(task.id, deps());
    expect((await taskRow(task.id)).last_error).toBeNull();
    expect((await one("SELECT unreachable_since FROM agent_task_runs")).unreachable_since).toBeNull();
  });

  it("marks a run Jack has forgotten as failed, never inventing an output", async () => {
    const { task, hermesRunId } = await createRunning();
    jack.runs.delete(hermesRunId);

    expect(await reconcileJackTask(task.id, deps())).toBe("failed");
    expect((await one("SELECT state FROM agent_task_runs")).state).toBe("lost");
    expect(String((await taskRow(task.id)).last_error)).toMatch(/no longer has a record/);
    expect(await all("SELECT id FROM agent_task_outputs")).toHaveLength(0);
  });

  it("does not retry an interrupted run on its own: it may have done part of the work", async () => {
    const { task, hermesRunId } = await createRunning();
    jack.setRun(hermesRunId, { status: "interrupted", error: "Gateway shutdown interrupted the run." });

    await reconcileJackTask(task.id, deps());
    expect(await taskRow(task.id)).toMatchObject({ jack_state: "failed", status: "failed" });
    expect((await one("SELECT state FROM agent_task_runs")).state).toBe("interrupted");

    await age(testDb, "agent_tasks", 120);
    await runJackQueuePass(deps());
    expect(jack.createCalls).toHaveLength(1);
  });

  it("is throttled for UI-triggered polls", async () => {
    const { task } = await createRunning();
    await reconcileJackTask(task.id, deps());
    expect(await reconcileJackTask(task.id, deps(), { minIntervalMs: 60_000 })).toBe("skipped");
    expect(jack.getCalls).toHaveLength(1);
  });
});

describe("approvals", () => {
  async function paused() {
    const { task, hermesRunId } = await createRunning();
    jack.setRun(hermesRunId, {
      status: "waiting_for_approval",
      approval: { request_id: "req-7", command: "create_note", description: "Save the draft as a note" },
    });
    await reconcileJackTask(task.id, deps());
    return { task, hermesRunId };
  }

  it("forwards Daniel's decision for the exact request shown, and records it", async () => {
    const { task, hermesRunId } = await paused();
    await resolveJackApproval(task.id, "u1", "once", "req-7", deps());

    expect(jack.approvalCalls).toEqual([{ runId: hermesRunId, choice: "once", requestId: "req-7" }]);
    expect((await taskRow(task.id)).jack_state).toBe("running");
    const event = await one("SELECT * FROM agent_task_events WHERE kind = 'approval_decided'");
    expect(event.actor).toBe("user");
    expect(JSON.parse(String(event.detail))).toMatchObject({ choice: "once", request_id: "req-7" });
  });

  it("refuses a stale request id, another user's task, and a task that is not paused", async () => {
    const { task } = await paused();
    await expect(resolveJackApproval(task.id, "u1", "once", "req-OLD", deps())).rejects.toMatchObject({ status: 409 });
    await expect(resolveJackApproval(task.id, "u2", "once", "req-7", deps())).rejects.toMatchObject({ status: 404 });
    expect(jack.approvalCalls).toHaveLength(0);

    const { task: other } = await createRunning();
    await expect(resolveJackApproval(other.id, "u1", "deny", null, deps())).rejects.toMatchObject({ status: 409 });
  });

  it("reconciles when Jack says the approval was already resolved", async () => {
    const { task, hermesRunId } = await paused();
    jack.approvalQueue.push(new JackError("conflict", "That approval has already been resolved or expired.", 409, "approval_not_pending"));
    jack.setRun(hermesRunId, { status: "running" });

    await expect(resolveJackApproval(task.id, "u1", "deny", "req-7", deps())).rejects.toBeInstanceOf(JackActionError);
    expect((await taskRow(task.id)).jack_state).toBe("running");
  });
});

describe("cancelling", () => {
  it("cancels work Jack never had without asking Jack", async () => {
    const { task } = await createJackTask(base, { config: DISABLED, client: jack });
    expect(await cancelJackTask(task.id, "u1", deps())).toBe("cancelled");
    expect(await taskRow(task.id)).toMatchObject({ jack_state: "cancelled", status: "rejected" });
    expect(jack.totalCalls).toBe(0);
  });

  it("asks Jack to stop, says 'stopping' until Jack confirms, then 'cancelled'", async () => {
    const { task, hermesRunId } = await createRunning();
    expect(await cancelJackTask(task.id, "u1", deps())).toBe("cancelling");
    expect(jack.stopCalls).toEqual([hermesRunId]);
    expect((await taskRow(task.id)).jack_state).toBe("cancelling");

    jack.setRun(hermesRunId, { status: "stopping" });
    await reconcileJackTask(task.id, deps());
    expect((await taskRow(task.id)).jack_state).toBe("cancelling");

    jack.setRun(hermesRunId, { status: "cancelled" });
    await reconcileJackTask(task.id, deps());
    expect(await taskRow(task.id)).toMatchObject({ jack_state: "cancelled", status: "rejected" });
  });

  it("keeps an answer that landed before the stop took effect", async () => {
    const { task, hermesRunId } = await createRunning();
    await cancelJackTask(task.id, "u1", deps());
    jack.setRun(hermesRunId, { status: "completed", output: "Finished anyway." });
    await reconcileJackTask(task.id, deps());
    expect((await taskRow(task.id)).jack_state).toBe("awaiting_review");
    expect(await all("SELECT id FROM agent_task_outputs")).toHaveLength(1);
  });

  it("refuses while the submission itself is in flight, and for other users", async () => {
    jack.createQueue.push(new JackError("timeout", "Jack did not answer within 15s."));
    const { task } = await createJackTask(base, deps());
    await expect(cancelJackTask(task.id, "u1", deps())).rejects.toMatchObject({ status: 409 });
    await expect(cancelJackTask(task.id, "u2", deps())).rejects.toMatchObject({ status: 404 });
  });
});

describe("review and revision continuity", () => {
  async function reviewed() {
    const { task, hermesRunId } = await createRunning();
    jack.setRun(hermesRunId, { status: "completed", output: "Version one." });
    await reconcileJackTask(task.id, deps());
    return task;
  }

  it("sends a revision as the next turn of the same Jack session, with the feedback and previous version", async () => {
    const task = await reviewed();
    expect(await requestJackRevision(task.id, "u1", "Shorter, and mention the new date.", deps())).toBe("dispatched");

    const second = jack.createCalls[1];
    expect(second.body.session_id).toBe(jack.createCalls[0].body.session_id);
    expect(second.body.input).toContain("Shorter, and mention the new date.");
    expect(second.body.input).toContain("Version one.");
    expect(second.key).not.toBe(jack.createCalls[0].key);
    expect((await one("SELECT kind FROM agent_task_runs ORDER BY created_at DESC, rowid DESC LIMIT 1")).kind).toBe("revision");

    jack.setRun("run_2", { status: "completed", output: "Version two." });
    await reconcileJackTask(task.id, deps());
    const versions = await all("SELECT version_number, content FROM agent_task_outputs ORDER BY version_number");
    expect(versions.map((v) => v.content)).toEqual(["Version one.", "Version two."]);
    expect((await taskRow(task.id)).current_version).toBe(2);
  });

  it("keeps the earlier version reviewable when a revision fails", async () => {
    const task = await reviewed();
    await requestJackRevision(task.id, "u1", "Try again", deps());
    jack.setRun("run_2", { status: "failed", error: "max_iterations_reached(60/60)" });
    await reconcileJackTask(task.id, deps());
    expect(await taskRow(task.id)).toMatchObject({ jack_state: "failed", status: "awaiting_review", current_version: 1 });
  });

  it("records review decisions alongside the coarse status", async () => {
    const task = await reviewed();
    await testDb.execute({ sql: "UPDATE agent_tasks SET status = 'approved' WHERE id = ?", args: [task.id] });
    await recordReviewDecision(task.id, "u1", "approved");
    expect((await taskRow(task.id)).jack_state).toBe("completed");
    expect((await one("SELECT actor, kind FROM agent_task_events WHERE kind = 'review_approved'")).actor).toBe("user");
  });

  it("turns a historical OpenRouter task into a Jack task when Daniel asks for a revision", async () => {
    await testDb.execute(`INSERT INTO agent_tasks (id, user_id, title, description, task_type, assigned_agent, status, current_version)
                          VALUES ('legacy1', 'u1', 'Old', 'Old instruction', 'general', 'general', 'awaiting_review', 1)`);
    await testDb.execute(`INSERT INTO agent_task_outputs (agent_task_id, version_number, content, model_used)
                          VALUES ('legacy1', 1, 'Old OpenRouter answer', 'minimax/minimax-m2.7')`);

    expect(await requestJackRevision("legacy1", "u1", "Update this", deps())).toBe("dispatched");
    expect(await taskRow("legacy1")).toMatchObject({ runtime: "jack", jack_state: "running" });
    expect(jack.createCalls[0].body.input).toContain("Old OpenRouter answer");
    // History stays readable and untouched.
    expect((await one("SELECT model_used FROM agent_task_outputs WHERE agent_task_id = 'legacy1'")).model_used).toBe("minimax/minimax-m2.7");
  });

  it("refuses a revision while Jack is still working", async () => {
    const { task } = await createRunning();
    await expect(requestJackRevision(task.id, "u1", "x", deps())).rejects.toMatchObject({ status: 400 });
  });
});

describe("the queue pass", () => {
  it("adopts rows written by MCP, heartbeat or skills and sends them to Jack", async () => {
    await testDb.execute(`INSERT INTO agent_tasks (id, user_id, title, description, task_type, assigned_agent, status)
                          VALUES ('mcp1', 'u1', 'From MCP', 'Research the venue', 'research', 'research', 'queued')`);
    const report = await runJackQueuePass(deps());
    expect(report).toMatchObject({ adopted: 1, dispatched: 1 });
    expect(await taskRow("mcp1")).toMatchObject({ runtime: "jack", jack_state: "running" });
  });

  it("with Jack off: adopts as 'not sent' and makes no call, even for runs in flight", async () => {
    const { task } = await createRunning();
    await testDb.execute(`INSERT INTO agent_tasks (id, user_id, title, description, task_type, assigned_agent, status)
                          VALUES ('mcp2', 'u1', 'From MCP', 'Research', 'research', 'research', 'queued')`);
    const before = jack.totalCalls;

    const report = await runJackQueuePass({ config: DISABLED, client: jack });
    expect(report.configured).toBe(false);
    expect(jack.totalCalls).toBe(before);
    expect((await taskRow("mcp2")).jack_state).toBe("needs_dispatch");
    expect((await taskRow(task.id)).jack_state).toBe("running");
  });

  it("puts a claim whose run row was never written back in the queue", async () => {
    await testDb.execute(`INSERT INTO agent_tasks (id, user_id, title, description, task_type, assigned_agent, status, runtime, jack_state)
                          VALUES ('crash1', 'u1', 'Crashed', 'Do it', 'general', 'general', 'processing', 'jack', 'dispatching')`);
    await age(testDb, "agent_tasks", 5);
    await runJackQueuePass(deps());
    expect((await taskRow("crash1")).jack_state).toBe("running");
    expect(jack.createCalls).toHaveLength(1);
  });
});

describe("sending and ownership", () => {
  it("sends parked work only on request, and only the owner can", async () => {
    const { task } = await createJackTask(base, { config: DISABLED, client: jack });
    await runJackQueuePass(deps());
    expect(jack.createCalls).toHaveLength(0);

    await expect(sendToJack(task.id, "u2", deps())).rejects.toMatchObject({ status: 404 });
    expect(await sendToJack(task.id, "u1", deps())).toBe("dispatched");
  });

  it("refuses to send while Jack is not configured, without changing anything", async () => {
    const { task } = await createJackTask(base, { config: DISABLED, client: jack });
    await expect(sendToJack(task.id, "u1", { config: DISABLED })).rejects.toMatchObject({ status: 503 });
    expect((await taskRow(task.id)).jack_state).toBe("needs_dispatch");
  });

  it("never puts another user's note in Jack's context, even if its id was stored", async () => {
    await testDb.execute(`INSERT INTO notes (id, user_id, title, slug, content, content_plain)
                          VALUES ('mine', 'u1', 'Mine', 'mine', 'my private plan', 'my private plan'),
                                 ('theirs', 'u2', 'Theirs', 'theirs', 'SOMEONE ELSES SECRET', 'SOMEONE ELSES SECRET')`);
    await createJackTask({ ...base, contextNoteIds: ["mine", "theirs"] }, deps());
    const input = jack.createCalls[0].body.input;
    expect(input).toContain("my private plan");
    expect(input).not.toContain("SOMEONE ELSES SECRET");
  });
});

describe("no OpenRouter spend", () => {
  it("runs a full create → approval → revise → complete cycle without one OpenRouter call", async () => {
    const { task, hermesRunId } = await createRunning();
    jack.setRun(hermesRunId, { status: "waiting_for_approval", approval: { request_id: "r", description: "x" } });
    await reconcileJackTask(task.id, deps());
    await resolveJackApproval(task.id, "u1", "deny", "r", deps());
    jack.setRun(hermesRunId, { status: "completed", output: "Done." });
    await reconcileJackTask(task.id, deps());
    await requestJackRevision(task.id, "u1", "More detail", deps());
    jack.setRun("run_2", { status: "completed", output: "Done, in detail." });
    await runJackQueuePass(deps());

    expect(aiClient.complete).not.toHaveBeenCalled();
    expect(aiClient.completeWithMeta).not.toHaveBeenCalled();
    expect((await taskRow(task.id)).current_version).toBe(2);
  });
});
