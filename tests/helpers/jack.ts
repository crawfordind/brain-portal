/**
 * Fixtures for the Jack runtime tests: the real schema plus the real Jack
 * migration on an in-memory libsql database, and a fake Hermes client whose
 * every call is recorded.
 *
 * The fake implements the same `JackClient` interface the dispatcher uses, so
 * the dispatcher under test is the production code path end to end, down to
 * the SQL. Only the network is replaced.
 */

import type { Client } from "@libsql/client";
import { schema } from "@/lib/db/schema";
import { applyJackRuntimeMigration } from "@/lib/agents/jack/schema";
import { JackError, type CreateRunBody, type HermesRun, type JackClient } from "@/lib/agents/jack/client";
import type { JackConfig } from "@/lib/agents/jack/config";

export const READY: JackConfig = {
  state: "ready",
  reason: null,
  baseUrl: "https://jack.test/p/jack",
  apiKey: "test-key-0123456789abcdef",
  profile: "jack",
  edgeHeaders: {},
};

export const DISABLED: JackConfig = {
  state: "disabled",
  reason: "Jack connection not configured. Set JACK_ENABLED=true once the Hermes endpoint is reachable.",
  baseUrl: "",
  apiKey: "",
  profile: "jack",
  edgeHeaders: {},
};

export async function applySchema(db: Client, options: { migrate?: boolean } = {}): Promise<void> {
  const statements = schema
    .replace(/CREATE TRIGGER[\s\S]*?END;/g, "")
    .replace(/^\s*--.*$/gm, "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const s of statements) await db.execute(s);
  if (options.migrate !== false) await applyJackRuntimeMigration(db);
}

export async function resetData(db: Client): Promise<void> {
  // tasks.agent_task_id and agent_tasks.task_id point at each other.
  await db.execute("PRAGMA foreign_keys = OFF");
  for (const table of [
    "agent_task_events",
    "agent_task_runs",
    "agent_task_feedback",
    "agent_task_outputs",
    "agent_tasks",
    "tasks",
    "notes",
    "projects",
    "captures",
    "users",
  ]) {
    await db.execute(`DELETE FROM ${table}`);
  }
  await db.execute("PRAGMA foreign_keys = ON");
  await db.execute(`INSERT INTO users (id, email) VALUES ('u1', 'daniel@example.com'), ('u2', 'other@example.com')`);
}

type Scripted<T> = T | Error | ((...args: unknown[]) => T | Promise<T>);

async function play<T>(step: Scripted<T> | undefined, fallback: () => T, ...args: unknown[]): Promise<T> {
  if (step === undefined) return fallback();
  if (step instanceof Error) throw step;
  if (typeof step === "function") return (step as (...a: unknown[]) => T | Promise<T>)(...args);
  return step;
}

export class FakeJackClient implements JackClient {
  createCalls: Array<{ body: CreateRunBody; key: string }> = [];
  getCalls: string[] = [];
  stopCalls: string[] = [];
  approvalCalls: Array<{ runId: string; choice: string; requestId: string | null }> = [];

  /** Queued responses, consumed in order; the default answers success. */
  createQueue: Array<Scripted<{ runId: string; replayed: boolean }>> = [];
  runs = new Map<string, HermesRun | Error>();
  approvalQueue: Array<Scripted<void>> = [];
  stopQueue: Array<Scripted<void>> = [];

  private counter = 0;
  /** Hermes semantics: the same idempotency key always returns the same run. */
  private byKey = new Map<string, string>();

  async createRun(body: CreateRunBody, key: string) {
    this.createCalls.push({ body, key });
    const step = this.createQueue.shift();
    return play(step, () => {
      const existing = this.byKey.get(key);
      if (existing) return { runId: existing, replayed: true };
      const runId = `run_${++this.counter}`;
      this.byKey.set(key, runId);
      this.runs.set(runId, { run_id: runId, status: "running" });
      return { runId, replayed: false };
    });
  }

  async getRun(runId: string): Promise<HermesRun> {
    this.getCalls.push(runId);
    const run = this.runs.get(runId);
    if (!run) throw new JackError("not_found", "Jack has no record of that run.", 404);
    if (run instanceof Error) throw run;
    return run;
  }

  async stopRun(runId: string) {
    this.stopCalls.push(runId);
    await play(this.stopQueue.shift(), () => undefined);
  }

  async resolveApproval(runId: string, choice: "once" | "deny", requestId: string | null) {
    this.approvalCalls.push({ runId, choice, requestId });
    await play(this.approvalQueue.shift(), () => undefined);
  }

  async capabilities() {
    return { model: "jack", features: { run_submission: true, run_status: true, run_stop: true } };
  }

  setRun(runId: string, run: Partial<HermesRun> | Error) {
    if (run instanceof Error) this.runs.set(runId, run);
    else this.runs.set(runId, { run_id: runId, status: "running", ...run } as HermesRun);
  }

  get totalCalls(): number {
    return this.createCalls.length + this.getCalls.length + this.stopCalls.length + this.approvalCalls.length;
  }
}

/** Push timestamps into the past so backoff and grace windows have elapsed. */
export async function age(db: Client, table: "agent_tasks" | "agent_task_runs", minutes: number): Promise<void> {
  await db.execute(`UPDATE ${table} SET updated_at = datetime('now', '-${minutes} minutes')`);
}
