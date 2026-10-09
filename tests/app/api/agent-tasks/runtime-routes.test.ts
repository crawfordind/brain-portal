/**
 * The delegated-task routes end to end: real route handlers, real dispatcher,
 * real SQL on an in-memory database. Only the network is replaced: Hermes by
 * a stubbed global fetch (so the real HTTP client runs too), OpenRouter by a
 * mocked completion, and Next's `after` by a queue the test drains.
 *
 * What is pinned: every route needs a session; every id the browser sends is
 * checked against that session's user; nothing privileged (the Hermes URL,
 * any key, the edge token, the idempotency key or the request body sent to the
 * runtime) ever appears in a response.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

const { testDb, currentUser, deferred } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createClient } = require("@libsql/client");
  return {
    testDb: createClient({ url: ":memory:" }),
    currentUser: { value: { id: "u1" } as { id: string } | null },
    deferred: [] as Array<() => Promise<unknown>>,
  };
});

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (work: () => Promise<unknown>) => { deferred.push(work); },
}));
vi.mock("@/lib/ai/client", () => ({
  completeWithMeta: vi.fn(async () => ({ content: "## Venues\n\nThree options.", model: "test/model", finishReason: "stop" })),
}));
vi.mock("@/lib/ai/models", () => ({ getModelChain: vi.fn(async () => ["test/model"]) }));

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
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn(async () => currentUser.value) }));

import { GET as listTasks, POST as createTask } from "@/app/api/agent-tasks/route";
import { GET as getTask, DELETE as deleteTask } from "@/app/api/agent-tasks/[id]/route";
import { POST as approval } from "@/app/api/agent-tasks/[id]/approval/route";
import { POST as cancel } from "@/app/api/agent-tasks/[id]/cancel/route";
import { POST as send } from "@/app/api/agent-tasks/[id]/send/route";
import { POST as revise } from "@/app/api/agent-tasks/[id]/revise/route";
import { GET as runtimeStatus } from "@/app/api/agent-runtime/status/route";
import * as aiClient from "@/lib/ai/client";
import { resetRuntimeRateLimits } from "@/lib/agents/runtime/guard";
import { applySchema, resetData } from "../../../helpers/agent-runtime";

const KEY = "hermes-secret-key-0123456789";
const URL_BASE = "https://agent-private.example.net/p/my-profile";
const EDGE_SECRET = "edge-secret-value-xyz";

function req(path: string, init: { method?: string; body?: unknown } = {}) {
  return new NextRequest(`http://localhost${path}`, {
    method: init.method ?? "GET",
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    headers: init.body !== undefined ? { "content-type": "application/json" } : undefined,
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

function enableHermes() {
  vi.stubEnv("AGENT_RUNTIME", "hermes");
  vi.stubEnv("HERMES_URL", URL_BASE);
  vi.stubEnv("HERMES_API_KEY", KEY);
  vi.stubEnv("HERMES_EDGE_CLIENT_ID", "edge-id");
  vi.stubEnv("HERMES_EDGE_CLIENT_SECRET", EDGE_SECRET);
}

function disableDelegation() {
  vi.stubEnv("AGENT_RUNTIME", "off");
}

/** A tiny Hermes: accepts runs, reports them running, then awaiting approval. */
function stubHermes() {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let status: Record<string, unknown> = { status: "running" };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith("/v1/runs")) return new Response(JSON.stringify({ run_id: "run_1", status: "started" }), { status: 202 });
    if (url.endsWith("/v1/capabilities")) {
      return new Response(JSON.stringify({ model: "my-profile", features: { run_submission: true, run_status: true, run_stop: true, run_approval: true } }), { status: 200 });
    }
    if (url.endsWith("/approval") || url.endsWith("/stop")) return new Response(JSON.stringify({ ok: true }), { status: 200 });
    return new Response(JSON.stringify({ run_id: "run_1", ...status }), { status: 200 });
  }));
  return { calls, setStatus: (s: Record<string, unknown>) => { status = s; } };
}

function assertNoSecrets(payload: unknown) {
  const text = JSON.stringify(payload);
  expect(text).not.toContain(KEY);
  expect(text).not.toContain("agent-private.example.net");
  expect(text).not.toContain("test-openrouter-key");
  expect(text).not.toContain(EDGE_SECRET);
  expect(text).not.toContain("idempotency");
  expect(text).not.toContain("request_body");
  expect(text).not.toContain("brain-portal:");
}

beforeAll(async () => {
  await applySchema(testDb);
});

beforeEach(async () => {
  await resetData(testDb);
  await testDb.execute(`INSERT INTO notes (id, user_id, title, slug, content) VALUES
    ('n-mine', 'u1', 'Mine', 'mine', 'm'), ('n-theirs', 'u2', 'Theirs', 'theirs', 't')`);
  await testDb.execute(`INSERT INTO projects (id, user_id, name, slug) VALUES
    ('p-mine', 'u1', 'Mine', 'mine'), ('p-theirs', 'u2', 'Theirs', 'theirs')`);
  currentUser.value = { id: "u1" };
  resetRuntimeRateLimits();
  deferred.length = 0;
  vi.mocked(aiClient.completeWithMeta).mockClear();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const valid = { title: "Research venues", description: "Find three venues near the farm." };

describe("authentication", () => {
  it("every delegated-task route answers 401 without a session", async () => {
    currentUser.value = null;
    const responses = await Promise.all([
      listTasks(req("/api/agent-tasks")),
      createTask(req("/api/agent-tasks", { method: "POST", body: valid })),
      getTask(req("/api/agent-tasks/x"), params("x")),
      deleteTask(req("/api/agent-tasks/x", { method: "DELETE" }), params("x")),
      approval(req("/api/agent-tasks/x/approval", { method: "POST", body: { choice: "once" } }), params("x")),
      cancel(req("/api/agent-tasks/x/cancel", { method: "POST" }), params("x")),
      send(req("/api/agent-tasks/x/send", { method: "POST" }), params("x")),
      revise(req("/api/agent-tasks/x/revise", { method: "POST", body: { feedback: "x" } }), params("x")),
      runtimeStatus(req("/api/agent-runtime/status")),
    ]);
    expect(responses.map((r) => r.status)).toEqual(Array(responses.length).fill(401));
  });
});

describe("POST /api/agent-tasks", () => {
  it("with delegation off: stores the task as not sent, says why, and calls nothing", async () => {
    disableDelegation();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await createTask(req("/api/agent-tasks", { method: "POST", body: valid }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.task).toMatchObject({ runtime: null, runtime_state: "needs_dispatch", assigned_agent: "general" });
    expect(body.agent.state).toBe("disabled");
    expect(body.agent.message).toMatch(/AGENT_RUNTIME=off/);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(aiClient.completeWithMeta).not.toHaveBeenCalled();
    expect(deferred).toHaveLength(0);
  });

  it("on OpenRouter (the default): answers at once and runs the model call after the response", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await createTask(req("/api/agent-tasks", { method: "POST", body: valid }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.dispatch).toBe("scheduled");
    expect(body.agent).toMatchObject({ runtime: "openrouter", state: "ready", capabilities: { approvals: false } });
    expect(aiClient.completeWithMeta).not.toHaveBeenCalled();
    assertNoSecrets(body);

    await Promise.all(deferred.map((work) => work()));
    expect(aiClient.completeWithMeta).toHaveBeenCalledTimes(1);
    const row = (await testDb.execute({ sql: "SELECT runtime, runtime_state FROM agent_tasks WHERE id = ?", args: [body.task.id] })).rows[0];
    expect({ ...row }).toEqual({ runtime: "openrouter", runtime_state: "awaiting_review" });
    // No Hermes endpoint was ever contacted.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("on Hermes: dispatches server-side, and the response carries no privileged detail", async () => {
    enableHermes();
    const hermes = stubHermes();
    const res = await createTask(req("/api/agent-tasks", { method: "POST", body: { ...valid, contextNoteIds: ["n-mine"] } }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.dispatch).toBe("dispatched");
    expect(body.task.runtime_state).toBe("running");
    expect(hermes.calls[0].url).toBe(`${URL_BASE}/v1/runs`);
    expect((hermes.calls[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    expect(deferred).toHaveLength(0);
    expect(aiClient.completeWithMeta).not.toHaveBeenCalled();
    assertNoSecrets(body);
  });

  it.each([
    [{ contextNoteIds: ["n-theirs"] }, 404, /pinned notes/],
    [{ projectId: "p-theirs" }, 404, /Project not found/],
    [{ sourceType: "note", sourceId: "n-theirs" }, 404, /Source not found/],
    [{ sourceType: "users", sourceId: "u2" }, 400, /Invalid source/],
    [{ contextNoteIds: ["a", "b", "c", "d", "e", "f"] }, 400, /at most 5/],
    [{ contextUrls: ["javascript:alert(1)"] }, 400, /http\(s\) URLs/],
    [{ assignedAgent: "root" }, 400, /Unknown agent type/],
    [{ description: "x".repeat(8_001) }, 400, /limited/],
  ])("refuses %o", async (extra, status, message) => {
    const res = await createTask(req("/api/agent-tasks", { method: "POST", body: { ...valid, ...extra } }));
    expect(res.status).toBe(status);
    expect((await res.json()).error).toMatch(message);
    expect((await testDb.execute("SELECT COUNT(*) AS n FROM agent_tasks")).rows[0].n).toBe(0);
  });

  it("accepts the user's own source, notes and project", async () => {
    const res = await createTask(req("/api/agent-tasks", {
      method: "POST",
      body: { ...valid, sourceType: "note", sourceId: "n-mine", contextNoteIds: ["n-mine"], projectId: "p-mine" },
    }));
    expect(res.status).toBe(201);
  });

  it("refuses an oversized body before parsing it", async () => {
    const res = await createTask(req("/api/agent-tasks", { method: "POST", body: { ...valid, padding: "x".repeat(70_000) } }));
    expect(res.status).toBe(413);
  });

  it("rate-limits per user", async () => {
    let last = 0;
    for (let i = 0; i < 21; i++) {
      last = (await createTask(req("/api/agent-tasks", { method: "POST", body: valid }))).status;
    }
    expect(last).toBe(429);
  });
});

describe("GET /api/agent-tasks/[id]", () => {
  it("shows the run's state, pending approval and audit trail to the owner only, with no privileged detail", async () => {
    enableHermes();
    const hermes = stubHermes();
    const created = await (await createTask(req("/api/agent-tasks", { method: "POST", body: valid }))).json();
    const id = created.task.id;
    hermes.setStatus({
      status: "waiting_for_approval",
      approval: { request_id: "req-9", command: `create_note --token ${KEY}`, description: "Save venues as a note" },
    });

    const res = await getTask(req(`/api/agent-tasks/${id}`), params(id));
    const body = await res.json();
    expect(body.task.runtime_state).toBe("awaiting_approval");
    expect(body.agent.approval).toMatchObject({ requestId: "req-9", description: "Save venues as a note" });
    expect(body.agent.runs[0]).toMatchObject({ externalRunId: "run_1", state: "awaiting_approval" });
    expect(body.agent.events.map((e: { kind: string }) => e.kind)).toEqual(["created", "dispatched", "approval_requested"]);
    assertNoSecrets(body);

    currentUser.value = { id: "u2" };
    expect((await getTask(req(`/api/agent-tasks/${id}`), params(id))).status).toBe(404);
  });

  it("does not resolve another user's notes even if their ids were stored on the task", async () => {
    await testDb.execute(`INSERT INTO agent_tasks (id, user_id, title, description, task_type, assigned_agent, context_note_ids, source_type, source_id)
                          VALUES ('t1', 'u1', 't', 'd', 'general', 'general', '["n-theirs","n-mine"]', 'note', 'n-theirs')`);
    const body = await (await getTask(req("/api/agent-tasks/t1"), params("t1"))).json();
    expect(body.contextNotes.map((n: { id: string }) => n.id)).toEqual(["n-mine"]);
    expect(body.sourceEntity).toBeNull();
  });

  it("still renders historical OpenRouter tasks and their outputs", async () => {
    await testDb.execute(`INSERT INTO agent_tasks (id, user_id, title, description, task_type, assigned_agent, status, current_version)
                          VALUES ('old', 'u1', 'Old', 'd', 'general', 'general', 'approved', 1)`);
    await testDb.execute(`INSERT INTO agent_task_outputs (agent_task_id, version_number, content, model_used)
                          VALUES ('old', 1, 'Historical answer', 'minimax/minimax-m2.7')`);
    const res = await getTask(req("/api/agent-tasks/old"), params("old"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.outputs[0]).toMatchObject({ content: "Historical answer", model_used: "minimax/minimax-m2.7" });
    expect(body.task.runtime).toBeNull();
    expect(body.agent.runs).toEqual([]);
  });
});

describe("action routes", () => {
  async function runningTask() {
    enableHermes();
    const hermes = stubHermes();
    const created = await (await createTask(req("/api/agent-tasks", { method: "POST", body: valid }))).json();
    return { id: created.task.id as string, hermes };
  }

  it("approval accepts only once/deny and forwards the shown request id", async () => {
    const { id, hermes } = await runningTask();
    hermes.setStatus({ status: "waiting_for_approval", approval: { request_id: "req-1", description: "d" } });
    await getTask(req(`/api/agent-tasks/${id}`), params(id));

    for (const choice of ["always", "session", "approve", ""]) {
      const res = await approval(req(`/api/agent-tasks/${id}/approval`, { method: "POST", body: { choice, requestId: "req-1" } }), params(id));
      expect(res.status).toBe(400);
    }
    const ok = await approval(req(`/api/agent-tasks/${id}/approval`, { method: "POST", body: { choice: "once", requestId: "req-1" } }), params(id));
    expect(ok.status).toBe(200);
    const sent = hermes.calls.find((c) => c.url.endsWith("/approval"))!;
    expect(JSON.parse(sent.init.body as string)).toEqual({ choice: "once", request_id: "req-1" });
  });

  it("another user cannot cancel, send, approve or delete", async () => {
    const { id } = await runningTask();
    currentUser.value = { id: "u2" };
    expect((await cancel(req(`/x`, { method: "POST" }), params(id))).status).toBe(404);
    expect((await send(req(`/x`, { method: "POST" }), params(id))).status).toBe(404);
    expect((await approval(req(`/x`, { method: "POST", body: { choice: "deny" } }), params(id))).status).toBe(404);
    expect((await deleteTask(req(`/x`, { method: "DELETE" }), params(id))).status).toBe(404);
  });

  it("refuses to delete a task the agent is still working on", async () => {
    const { id } = await runningTask();
    expect((await deleteTask(req(`/x`, { method: "DELETE" }), params(id))).status).toBe(409);
    expect((await cancel(req(`/x`, { method: "POST" }), params(id))).status).toBe(200);
  });

  it("send answers 503 with an honest message while delegation is off", async () => {
    disableDelegation();
    const created = await (await createTask(req("/api/agent-tasks", { method: "POST", body: valid }))).json();
    const res = await send(req(`/x`, { method: "POST" }), params(created.task.id));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/AGENT_RUNTIME=off/);
  });
});

describe("GET /api/agent-runtime/status", () => {
  it("reports configuration in words and runs a live check without leaking anything", async () => {
    enableHermes();
    stubHermes();
    const plain = await (await runtimeStatus(req("/api/agent-runtime/status"))).json();
    expect(plain.state).toBe("ready");
    assertNoSecrets(plain);

    const checked = await (await runtimeStatus(req("/api/agent-runtime/status?check=true"))).json();
    expect(checked.check).toMatchObject({ reachable: true, profileMatches: true, ok: true });
    assertNoSecrets(checked);
  });

  it("makes no live call on OpenRouter, even when asked to check", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const body = await (await runtimeStatus(req("/api/agent-runtime/status?check=true"))).json();
    expect(body).toMatchObject({ runtime: "openrouter", state: "ready" });
    expect(body.check).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
    assertNoSecrets(body);
  });
});
