/**
 * A ChatGPT refresh token works once. Two server instances refreshing the same
 * sign-in together would leave one holding a dead token, so refreshing is
 * serialized through a database lease. Real SQL, in-memory libsql.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const { testDb, refresh } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createClient } = require("@libsql/client");
  return { testDb: createClient({ url: ":memory:" }), refresh: vi.fn() };
});

vi.mock("@/lib/db/client", () => ({ db: testDb }));
vi.mock("@/lib/ai/chatgpt/oauth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/chatgpt/oauth")>()),
  refreshChatGptSession: (...a: unknown[]) => refresh(...a),
}));

import { applyUserAiKeysMigration } from "@/lib/ai/credentials/schema";
import { chatGptAccessToken, saveChatGptSession } from "@/lib/ai/chatgpt/session";
import { ChatGptAuthError } from "@/lib/ai/chatgpt/oauth";
import type { ChatGptSession } from "@/lib/ai/chatgpt/types";

const session = (over: Partial<ChatGptSession> = {}): ChatGptSession => ({
  clientId: "oaiapp_1",
  hostId: "h",
  idToken: "",
  accessToken: "old-token",
  refreshToken: "rt1",
  expiresAt: Date.now() - 1000,
  scopes: ["chatgpt.tokens.use.direct"],
  email: "owner@example.com",
  savedAt: 0,
  ...over,
});

beforeEach(async () => {
  for (const t of ["user_ai_keys", "users"]) await testDb.execute(`DROP TABLE IF EXISTS ${t}`);
  await testDb.execute(`CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, preferences TEXT DEFAULT '{}', updated_at TEXT)`);
  await testDb.execute(`INSERT INTO users (id, email) VALUES ('u1', 'owner@example.com')`);
  await applyUserAiKeysMigration(testDb);
  refresh.mockReset();
});

describe("ChatGPT sign-in refresh", () => {
  it("returns a current token without refreshing", async () => {
    const live = session({ expiresAt: Date.now() + 30 * 60_000 });
    expect(await chatGptAccessToken(testDb, "u1", live)).toBe("old-token");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes once when two callers find the token lapsed at the same time", async () => {
    const stale = session();
    await saveChatGptSession(testDb, "u1", stale);
    refresh.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 200));
      return session({ accessToken: "new-token", refreshToken: "rt2", expiresAt: Date.now() + 3600_000 });
    });

    const [a, b] = await Promise.all([chatGptAccessToken(testDb, "u1", stale), chatGptAccessToken(testDb, "u1", stale)]);

    expect([a, b]).toEqual(["new-token", "new-token"]);
    expect(refresh).toHaveBeenCalledTimes(1);
    const row = await testDb.execute("SELECT refresh_lock_until FROM user_ai_keys WHERE user_id = 'u1'");
    expect(row.rows[0].refresh_lock_until).toBeNull();
  });

  it("marks the sign-in for renewal when ChatGPT ends it", async () => {
    await saveChatGptSession(testDb, "u1", session());
    refresh.mockRejectedValue(new ChatGptAuthError("Your ChatGPT sign-in has ended.", { needsSignIn: true, status: 401 }));

    await expect(chatGptAccessToken(testDb, "u1", session())).rejects.toThrow(/has ended/);
    const row = await testDb.execute("SELECT status, last_error, refresh_lock_until FROM user_ai_keys WHERE user_id = 'u1'");
    expect(row.rows[0]).toMatchObject({ status: "invalid", refresh_lock_until: null });
  });
});
