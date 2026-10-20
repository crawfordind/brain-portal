/**
 * The usage log against a real in-memory libsql database: one row per call,
 * running totals per model, and a database without the tables recording
 * nothing rather than failing the call.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const { testDb } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createClient } = require("@libsql/client");
  return { testDb: createClient({ url: ":memory:" }) };
});

vi.mock("@/lib/db/client", () => ({ db: testDb }));

import { applyAiUsageMigration } from "@/lib/ai/usage/schema";
import { getAiUsageReport, recordAiUsage, resetAiUsage, resetUsageStoreState } from "@/lib/ai/usage/store";
import { formatPromptPreview, formatTokens, jobPurpose, type AiUsageEvent } from "@/lib/ai/usage/types";

const event = (over: Partial<AiUsageEvent> = {}): AiUsageEvent => ({
  userId: "u1",
  provider: "anthropic",
  model: "claude-opus-5-5",
  source: "user",
  kind: "chat",
  slot: "fast",
  purpose: "Note summary",
  prompt: "[user]\nSummarize this",
  inputTokens: 100,
  outputTokens: 20,
  status: "ok",
  error: null,
  durationMs: 1200,
  ...over,
});

async function reset({ withTables = true } = {}) {
  for (const t of ["ai_usage_events", "ai_usage_totals", "users"]) await testDb.execute(`DROP TABLE IF EXISTS ${t}`);
  await testDb.execute(`CREATE TABLE users (id TEXT PRIMARY KEY)`);
  await testDb.execute(`INSERT INTO users (id) VALUES ('u1'), ('u2')`);
  if (withTables) await applyAiUsageMigration(testDb);
  resetUsageStoreState();
}

describe("AI usage store", () => {
  beforeEach(() => reset());

  it("keeps a running total per model and whose key, and lists the calls newest first", async () => {
    await recordAiUsage(event());
    await recordAiUsage(event({ inputTokens: 50, outputTokens: 5, purpose: "Chat" }));
    await recordAiUsage(event({ provider: "openrouter", model: "openai/text-embedding-3-small", source: "server", kind: "embedding", inputTokens: 7, outputTokens: 0 }));
    await recordAiUsage(event({ userId: "u2", inputTokens: 999 }));

    const report = await getAiUsageReport("u1");
    expect(report.available).toBe(true);
    expect(report.totals).toEqual([
      expect.objectContaining({ provider: "anthropic", model: "claude-opus-5-5", source: "user", calls: 2, inputTokens: 150, outputTokens: 25 }),
      expect.objectContaining({ model: "openai/text-embedding-3-small", source: "server", calls: 1, inputTokens: 7 }),
    ]);
    expect(report.recent).toHaveLength(3);
    expect(report.recent.map((e) => e.purpose)).toContain("Chat");
    // Another account's usage never shows.
    expect(report.recent.every((e) => e.inputTokens !== 999)).toBe(true);
  });

  it("records failures with the provider's message, minus anything key-shaped", async () => {
    await recordAiUsage(event({ status: "error", error: "401 bad key sk-ant-api03-abcdefghijkl", inputTokens: 0, outputTokens: 0 }));
    const [row] = (await getAiUsageReport("u1")).recent;
    expect(row.status).toBe("error");
    expect(row.error).toContain("[key]");
    expect(row.error).not.toContain("abcdefghijkl");
  });

  it("reset clears the totals and the history for that account only", async () => {
    await recordAiUsage(event());
    await recordAiUsage(event({ userId: "u2" }));
    await resetAiUsage("u1");
    expect((await getAiUsageReport("u1")).totals).toEqual([]);
    expect((await getAiUsageReport("u2")).totals).toHaveLength(1);
  });

  it("records nothing, and throws nothing, before the migration has run", async () => {
    await reset({ withTables: false });
    await expect(recordAiUsage(event())).resolves.toBeUndefined();
    expect(await getAiUsageReport("u1")).toEqual({ available: false, totals: [], recent: [] });
  });
});

describe("usage formatting", () => {
  it("labels each message with its role and names images instead of inlining them", () => {
    const text = formatPromptPreview([
      { role: "system", content: "Be brief." },
      { role: "user", content: [{ type: "text", text: "What is this?" }, { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }] },
    ]);
    expect(text).toBe("[system]\nBe brief.\n\n[user]\nWhat is this?\n[image]");
    expect(text).not.toContain("base64");
  });

  it("cuts a long prompt in the middle, keeping the instructions and the question", () => {
    const text = formatPromptPreview([{ role: "system", content: "START" + "x".repeat(10_000) }, { role: "user", content: "THE QUESTION" }], 1000);
    expect(text.length).toBeLessThanOrEqual(1100);
    expect(text).toContain("START");
    expect(text).toContain("THE QUESTION");
    expect(text).toContain("characters left out");
  });

  it("shortens token counts and names background jobs", () => {
    expect([formatTokens(812), formatTokens(34_567), formatTokens(1_234_567)]).toEqual(["812", "35k", "1.2M"]);
    expect(jobPurpose("generate_summary")).toBe("Note summary");
    expect(jobPurpose("rebuild_index")).toBe("Rebuild index");
  });
});
