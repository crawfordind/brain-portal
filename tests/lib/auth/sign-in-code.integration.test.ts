/**
 * Sign-in codes and links against a real in-memory libsql database, so the
 * actual SQL runs: the UPDATE … RETURNING that charges each guess, the
 * julianday expiry, and the fallback for a database without the code column.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const { testDb } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createClient } = require("@libsql/client");
  return { testDb: createClient({ url: ":memory:" }) };
});

vi.mock("@/lib/db/client", () => {
  const query = async (sql: string, args: unknown[] = []) =>
    (await testDb.execute({ sql, args })).rows.map((r: object) => ({ ...r }));
  const queryOne = async (sql: string, args: unknown[] = []) => (await query(sql, args))[0] ?? null;
  return { db: testDb, query, queryAll: query, queryOne, mutate: queryOne };
});

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

import { createSignIn, createMagicLink, verifyMagicLink, verifySignInCode } from "@/lib/auth";
import { MAX_CODE_ATTEMPTS } from "@/lib/auth/magic-link";

const OWNER = "owner@example.com";

async function setupSchema({ withCodeColumns = true } = {}) {
  for (const table of ["sessions", "magic_links", "users"]) {
    await testDb.execute(`DROP TABLE IF EXISTS ${table}`);
  }
  await testDb.execute(`CREATE TABLE users (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    email TEXT UNIQUE NOT NULL
  )`);
  await testDb.execute(`CREATE TABLE sessions (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id TEXT NOT NULL,
    token TEXT UNIQUE NOT NULL,
    expires_at TEXT NOT NULL
  )`);
  await testDb.execute(`CREATE TABLE magic_links (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    email TEXT NOT NULL,
    token TEXT UNIQUE NOT NULL,
    expires_at TEXT NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    ${withCodeColumns ? "code_hash TEXT, code_attempts INTEGER DEFAULT 0," : ""}
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  // Stored with a capital, as accounts created before normalisation may be.
  await testDb.execute({ sql: "INSERT INTO users (id, email) VALUES ('u1', ?)", args: ["Owner@example.com"] });
}

/** Any six digits that are not `code`. */
const wrong = (code: string) => (code === "000000" ? "111111" : "000000");
const tokenOf = (url: string) => new URL(url).searchParams.get("token")!;

describe("sign-in codes", () => {
  beforeEach(async () => {
    await setupSchema();
  });

  it("signs in with the emailed code, typed with a space, on any device", async () => {
    const { code } = await createSignIn(OWNER, { baseUrl: "https://app.example.com" });
    expect(code).toMatch(/^\d{6}$/);

    const result = await verifySignInCode("Owner@Example.com", `${code!.slice(0, 3)} ${code!.slice(3)}`);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.user.id).toBe("u1");
  });

  it("spends the whole login: the code and its link work once between them", async () => {
    const { url, code } = await createSignIn(OWNER, { baseUrl: "https://app.example.com" });

    expect((await verifySignInCode(OWNER, code!)).ok).toBe(true);
    expect(await verifyMagicLink(OWNER, tokenOf(url))).toEqual({ ok: false, reason: "used" });
    expect(await verifySignInCode(OWNER, code!)).toEqual({ ok: false, reason: "expired" });
  });

  it("accepts the code from an earlier email after a resend", async () => {
    const first = await createSignIn(OWNER, { baseUrl: "https://app.example.com" });
    await createSignIn(OWNER, { baseUrl: "https://app.example.com" });

    expect((await verifySignInCode(OWNER, first.code!)).ok).toBe(true);
  });

  it("stops accepting codes after too many wrong guesses, but the link still works", async () => {
    const { url, code } = await createSignIn(OWNER, { baseUrl: "https://app.example.com" });

    for (let i = 1; i < MAX_CODE_ATTEMPTS; i++) {
      const miss = await verifySignInCode(OWNER, wrong(code!));
      expect(miss).toEqual({ ok: false, reason: "wrong_code", attemptsLeft: MAX_CODE_ATTEMPTS - i });
    }
    expect(await verifySignInCode(OWNER, wrong(code!))).toMatchObject({ ok: false, reason: "locked" });
    // Even the right code is refused now…
    expect(await verifySignInCode(OWNER, code!)).toEqual({ ok: false, reason: "locked" });
    // …but a guesser cannot lock the owner out of the email they were sent.
    expect((await verifyMagicLink(OWNER, tokenOf(url))).ok).toBe(true);
  });

  it("refuses a code after its link expired", async () => {
    const { code } = await createSignIn(OWNER, { baseUrl: "https://app.example.com" });
    await testDb.execute("UPDATE magic_links SET expires_at = '2020-01-01T00:00:00.000Z'");

    expect(await verifySignInCode(OWNER, code!)).toEqual({ ok: false, reason: "expired" });
  });

  it("will not accept one address's code for another address", async () => {
    await testDb.execute("INSERT INTO users (id, email) VALUES ('u2', 'someone@example.com')");
    const { code } = await createSignIn(OWNER, { baseUrl: "https://app.example.com" });

    expect(await verifySignInCode("someone@example.com", code!)).toEqual({ ok: false, reason: "expired" });
  });

  it("gives project invites a link only, never a long-lived code", async () => {
    await createMagicLink(OWNER, "https://app.example.com", 7 * 24 * 60 * 60);
    const row = await testDb.execute("SELECT code_hash FROM magic_links");
    expect(row.rows[0].code_hash).toBeNull();
  });

  it("never stores the code itself", async () => {
    const { code } = await createSignIn(OWNER, { baseUrl: "https://app.example.com" });
    const row = await testDb.execute("SELECT * FROM magic_links");
    expect(JSON.stringify(row.rows)).not.toContain(code!);
  });
});

describe("a database not yet migrated for codes", () => {
  beforeEach(async () => {
    await setupSchema({ withCodeColumns: false });
  });

  it("still sends a working link, without a code", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { url, code } = await createSignIn(OWNER, { baseUrl: "https://app.example.com" });

    expect(code).toBeNull();
    expect((await verifyMagicLink(OWNER, tokenOf(url))).ok).toBe(true);
    warn.mockRestore();
  });
});
