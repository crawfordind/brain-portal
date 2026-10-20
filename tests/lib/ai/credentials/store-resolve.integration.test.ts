/**
 * Personal keys against a real in-memory libsql database: the actual SQL for
 * saving, listing, decrypting and choosing, and the preferences blob that
 * other settings share.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const { testDb } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createClient } = require("@libsql/client");
  return { testDb: createClient({ url: ":memory:" }) };
});

vi.mock("@/lib/db/client", () => ({ db: testDb }));

import { applyUserAiKeysMigration } from "@/lib/ai/credentials/schema";
import {
  deleteUserAiKey,
  listUserAiKeys,
  loadUserAiKeys,
  readAiPreferences,
  recordKeyStatus,
  saveUserAiKey,
  updateAiPreferences,
} from "@/lib/ai/credentials/store";
import { AiCredentialError, invalidateAiCredentialCache, resolveAiCredential } from "@/lib/ai/credentials/resolve";
import { runWithAiUser } from "@/lib/ai/credentials/context";
import { resolveAiCredentialChain } from "@/lib/ai/credentials/resolve";
import { saveChatGptSession } from "@/lib/ai/chatgpt/session";

const CLAUDE = "sk-ant-api03-" + "c".repeat(40);
const OPENAI = "sk-proj-" + "o".repeat(40);
const env = { SESSION_SECRET: "test-session-secret-long-enough", OPENROUTER_API_KEY: "sk-or-server" };

async function reset({ withTable = true } = {}) {
  for (const t of ["user_ai_keys", "users"]) await testDb.execute(`DROP TABLE IF EXISTS ${t}`);
  await testDb.execute(`CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, preferences TEXT DEFAULT '{}', updated_at TEXT)`);
  await testDb.execute(`INSERT INTO users (id, email, preferences) VALUES ('u1', 'owner@example.com', '{"models":{"fast":"x/y"}}'), ('u2', 'other@example.com', '{}')`);
  if (withTable) await applyUserAiKeysMigration(testDb);
  invalidateAiCredentialCache();
}

describe("personal AI keys, stored", () => {
  beforeEach(async () => {
    vi.stubEnv("SESSION_SECRET", env.SESSION_SECRET);
    await reset();
  });

  it("saves encrypted, lists only a hint, and decrypts for calls", async () => {
    await saveUserAiKey(testDb, { userId: "u1", provider: "anthropic", apiKey: CLAUDE, verified: true });

    const raw = await testDb.execute("SELECT * FROM user_ai_keys");
    expect(JSON.stringify(raw.rows)).not.toContain(CLAUDE);

    const [summary] = await listUserAiKeys(testDb, "u1");
    expect(summary).toMatchObject({ provider: "anthropic", hint: "sk-ant-…cccc", status: "ok" });
    expect(JSON.stringify(summary)).not.toContain(CLAUDE);

    expect(await loadUserAiKeys(testDb, "u1")).toEqual([{ provider: "anthropic", apiKey: CLAUDE, status: "ok" }]);
    expect(await loadUserAiKeys(testDb, "u2")).toEqual([]);
  });

  it("replaces a provider's key rather than keeping two", async () => {
    await saveUserAiKey(testDb, { userId: "u1", provider: "openai", apiKey: OPENAI });
    await recordKeyStatus(testDb, "u1", "openai", "invalid", "rejected");
    await saveUserAiKey(testDb, { userId: "u1", provider: "openai", apiKey: "sk-proj-" + "n".repeat(40), verified: true });

    const keys = await listUserAiKeys(testDb, "u1");
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({ hint: "sk-…nnnn", status: "ok", lastError: null });
  });

  it("keeps unrelated preferences when saving AI ones", async () => {
    await updateAiPreferences(testDb, "u1", { provider: "anthropic", models: { provider: "anthropic", slots: { fast: "claude-haiku-5-5" } } });
    const row = await testDb.execute("SELECT preferences FROM users WHERE id = 'u1'");
    expect(JSON.parse(row.rows[0].preferences as string)).toMatchObject({
      models: { fast: "x/y" },
      ai_provider: "anthropic",
      models_by_provider: { anthropic: { fast: "claude-haiku-5-5" } },
    });
    await updateAiPreferences(testDb, "u1", { models: { provider: "anthropic", slots: { fast: null } } });
    expect((await readAiPreferences(testDb, "u1")).modelsByProvider.anthropic).toEqual({});
  });

  it("treats a database without the table as having no keys", async () => {
    await reset({ withTable: false });
    expect(await listUserAiKeys(testDb, "u1")).toEqual([]);
    expect(await loadUserAiKeys(testDb, "u1")).toEqual([]);
  });
});

describe("resolveAiCredential", () => {
  beforeEach(async () => {
    vi.stubEnv("SESSION_SECRET", env.SESSION_SECRET);
    await reset();
  });

  it("bills the account's own key, and the server's only for accounts without one", async () => {
    await saveUserAiKey(testDb, { userId: "u1", provider: "anthropic", apiKey: CLAUDE });

    await expect(resolveAiCredential("chat", { userId: "u1", env })).resolves.toMatchObject({
      provider: "anthropic",
      apiKey: CLAUDE,
      source: "user",
    });
    await expect(resolveAiCredential("chat", { userId: "u2", env })).resolves.toMatchObject({
      provider: "openrouter",
      apiKey: "sk-or-server",
      source: "server",
    });
  });

  it("takes the account from runWithAiUser when the call site can't say", async () => {
    await saveUserAiKey(testDb, { userId: "u1", provider: "openai", apiKey: OPENAI });
    const credential = await runWithAiUser("u1", () => resolveAiCredential("embedding", { env }));
    expect(credential).toMatchObject({ provider: "openai", source: "user", userId: "u1" });
  });

  it("does not leak one job's account into the next", async () => {
    await saveUserAiKey(testDb, { userId: "u1", provider: "openai", apiKey: OPENAI });
    await runWithAiUser("u1", async () => {});
    await expect(resolveAiCredential("chat", { env })).resolves.toMatchObject({ source: "server", userId: null });
  });

  it("asks for a key again rather than using another one when it can't be decrypted", async () => {
    await saveUserAiKey(testDb, { userId: "u1", provider: "anthropic", apiKey: CLAUDE });
    vi.stubEnv("SESSION_SECRET", "a-rotated-secret-that-is-different");
    invalidateAiCredentialCache();

    const error = await resolveAiCredential("chat", { userId: "u1", env }).catch((e) => e);
    expect(error).toBeInstanceOf(AiCredentialError);
    expect(error.code).toBe("key_unreadable");
  });

  it("forgets a deleted key at once in this process", async () => {
    await saveUserAiKey(testDb, { userId: "u1", provider: "anthropic", apiKey: CLAUDE });
    await resolveAiCredential("chat", { userId: "u1", env });
    await deleteUserAiKey(testDb, "u1", "anthropic");
    invalidateAiCredentialCache("u1");
    await expect(resolveAiCredential("chat", { userId: "u1", env })).resolves.toMatchObject({ source: "server" });
  });

  it("refuses rather than charging the server under user_only", async () => {
    const error = await resolveAiCredential("chat", { userId: "u2", env: { ...env, AI_KEY_POLICY: "user_only" } }).catch((e) => e);
    expect(error).toBeInstanceOf(AiCredentialError);
    expect(error.message).toMatch(/Settings → AI provider/);
  });

  describe("a ChatGPT plan beside pay-per-token keys", () => {
    const plan = {
      clientId: "oaiapp_1",
      hostId: "h",
      idToken: "",
      accessToken: "plan-access-token",
      refreshToken: "rt",
      expiresAt: Date.now() + 3600_000,
      scopes: ["chatgpt.tokens.use.direct"],
      email: "owner@example.com",
      savedAt: Date.now(),
    };
    const chain = async (capability: "chat" | "embedding", extra: Record<string, string> = {}) =>
      (await resolveAiCredentialChain(capability, { userId: "u1", db: testDb, env: { ...env, ADMIN_EMAILS: "owner@example.com", ...extra } })).map(
        (c) => `${c.source}:${c.provider}`
      );

    beforeEach(async () => {
      await saveChatGptSession(testDb, "u1", plan);
      await saveUserAiKey(testDb, { userId: "u1", provider: "openai", apiKey: OPENAI, verified: true });
      invalidateAiCredentialCache();
    });

    it("tries the plan first with the sign-in's access token, and backs it up with the account's keys", async () => {
      const resolved = await resolveAiCredentialChain("chat", { userId: "u1", db: testDb, env: { ...env, ADMIN_EMAILS: "owner@example.com" } });
      expect(resolved[0]).toMatchObject({ provider: "chatgpt", apiKey: "plan-access-token", source: "user" });
      expect(await chain("chat")).toEqual(["user:chatgpt", "user:openai"]);
      // The single-credential path still picks one, the plan.
      expect((await resolveAiCredential("chat", { userId: "u1", db: testDb, env: { ...env, ADMIN_EMAILS: "owner@example.com" } })).provider).toBe("chatgpt");
    });

    it("never stores the sign-in readable, and lists it by account, not by token", async () => {
      const raw = await testDb.execute("SELECT * FROM user_ai_keys WHERE provider = 'chatgpt'");
      expect(JSON.stringify(raw.rows)).not.toContain("plan-access-token");
      const summary = (await listUserAiKeys(testDb, "u1")).find((k) => k.provider === "chatgpt");
      expect(summary).toMatchObject({ hint: "ChatGPT plan · owner@example.com", source: "connect" });
    });

    it("keeps background work off the plan until the person agrees", async () => {
      const background = await runWithAiUser("u1", () => chain("chat"));
      expect(background).toEqual(["user:openai"]);
      await updateAiPreferences(testDb, "u1", { routing: { chatgptBackground: true } });
      invalidateAiCredentialCache();
      expect(await runWithAiUser("u1", () => chain("chat"))).toEqual(["user:chatgpt", "user:openai"]);
    });

    it("ignores the plan for an account that may not use one here", async () => {
      expect(await chain("chat", { ADMIN_EMAILS: "someone-else@example.com" })).toEqual(["user:openai"]);
    });

    it("uses only the first when backups are off, and never the plan for search indexing", async () => {
      expect(await chain("embedding")).toEqual(["user:openai"]);
      await updateAiPreferences(testDb, "u1", { routing: { fallback: false } });
      invalidateAiCredentialCache();
      expect(await chain("chat")).toEqual(["user:chatgpt"]);
    });
  });
});
