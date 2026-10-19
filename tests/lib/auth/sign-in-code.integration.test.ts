/**
 * Sign-in codes and links against a real in-memory libsql database, so the
 * actual SQL runs: the UPDATE … RETURNING that charges each guess, the
 * julianday expiry, the per-link use allowance, and the fallbacks for a
 * database not yet migrated.
 *
 * The scenario these exist for: a corporate mail scanner opens the link (in a
 * real browser that runs JavaScript) before the person does. The person's own
 * click, and the code in the same email, must both still work.
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
import { MAX_CODE_ATTEMPTS, MAX_LINK_USES } from "@/lib/auth/magic-link";

const OWNER = "owner@example.com";

/** "current": every column. "codes": before scanner-proofing. "none": before codes. */
async function setupSchema({ columns = "current" }: { columns?: "current" | "codes" | "none" } = {}) {
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
    ${columns !== "none" ? "code_hash TEXT, code_attempts INTEGER DEFAULT 0," : ""}
    ${columns === "current" ? "code_used INTEGER DEFAULT 0, link_uses INTEGER DEFAULT 0, browser_hash TEXT," : ""}
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

  it("accepts a code once", async () => {
    const { code } = await createSignIn(OWNER, { baseUrl: "https://app.example.com" });

    expect((await verifySignInCode(OWNER, code!)).ok).toBe(true);
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

describe("a mail scanner opens the link first", () => {
  const BROWSER = "e".repeat(64);
  const OTHER_BROWSER = "f".repeat(64);
  const signIn = () => createSignIn(OWNER, { baseUrl: "https://app.example.com", browserSecret: BROWSER });
  /** What a scanner does: post the form from a browser without the cookie. */
  const scan = (url: string) => verifyMagicLink(OWNER, tokenOf(url), { browserSecret: null });

  beforeEach(async () => {
    await setupSchema();
  });

  it("leaves the code working", async () => {
    const { url, code } = await signIn();
    for (let i = 0; i < MAX_LINK_USES; i++) expect((await scan(url)).ok).toBe(true);
    expect(await scan(url)).toEqual({ ok: false, reason: "used" });

    expect((await verifySignInCode(OWNER, code!)).ok).toBe(true);
  });

  it("leaves the link working for the person on another device", async () => {
    const { url } = await signIn();
    expect((await scan(url)).ok).toBe(true);

    expect((await verifyMagicLink(OWNER, tokenOf(url), { browserSecret: OTHER_BROWSER })).ok).toBe(true);
  });

  it("always lets in the browser that asked, however many scanners got there first", async () => {
    const { url } = await signIn();
    for (let i = 0; i < MAX_LINK_USES; i++) await scan(url);

    expect((await verifyMagicLink(OWNER, tokenOf(url), { browserSecret: BROWSER })).ok).toBe(true);
    expect((await verifyMagicLink(OWNER, tokenOf(url), { browserSecret: BROWSER })).ok).toBe(true);
    // A different secret is not that browser.
    expect(await verifyMagicLink(OWNER, tokenOf(url), { browserSecret: OTHER_BROWSER })).toEqual({
      ok: false,
      reason: "used",
    });
  });

  it("does not let the browser that asked in after the link expired", async () => {
    const { url } = await signIn();
    await testDb.execute("UPDATE magic_links SET expires_at = '2020-01-01T00:00:00.000Z'");

    expect(await verifyMagicLink(OWNER, tokenOf(url), { browserSecret: BROWSER })).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("keeps a used-up link's code alive across a resend", async () => {
    const first = await signIn();
    for (let i = 0; i < MAX_LINK_USES; i++) await scan(first.url);
    await signIn();

    expect((await verifySignInCode(OWNER, first.code!)).ok).toBe(true);
  });

  it("never stores the browser's secret itself", async () => {
    await signIn();
    const row = await testDb.execute("SELECT * FROM magic_links");
    expect(JSON.stringify(row.rows)).not.toContain(BROWSER);
  });

  it("refuses racing scanners more uses than the link allows", async () => {
    const { url } = await signIn();
    const results = await Promise.all(Array.from({ length: MAX_LINK_USES + 3 }, () => scan(url)));
    expect(results.filter((r) => r.ok)).toHaveLength(MAX_LINK_USES);
  });
});

describe("a database migrated for codes but not for scanner-proofing", () => {
  beforeEach(async () => {
    await setupSchema({ columns: "codes" });
  });

  it("still signs in with the code and the link, as before", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const first = await createSignIn(OWNER, { baseUrl: "https://app.example.com", browserSecret: "e".repeat(64) });
    const second = await createSignIn(OWNER, { baseUrl: "https://app.example.com" });

    expect(first.code).toMatch(/^\d{6}$/);
    expect((await verifySignInCode(OWNER, first.code!)).ok).toBe(true);
    expect((await verifyMagicLink(OWNER, tokenOf(second.url))).ok).toBe(true);
    // One use per link there, as there always was.
    expect(await verifyMagicLink(OWNER, tokenOf(second.url))).toEqual({ ok: false, reason: "used" });
    warn.mockRestore();
  });
});

describe("a database not yet migrated for codes", () => {
  beforeEach(async () => {
    await setupSchema({ columns: "none" });
  });

  it("still sends a working link, without a code", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { url, code } = await createSignIn(OWNER, { baseUrl: "https://app.example.com" });

    expect(code).toBeNull();
    expect((await verifyMagicLink(OWNER, tokenOf(url))).ok).toBe(true);
    warn.mockRestore();
  });
});
