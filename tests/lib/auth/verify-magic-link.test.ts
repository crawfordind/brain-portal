/**
 * `createMagicLink` / `verifyMagicLink` against a mocked database.
 *
 * Pins the three ways a link used to die before the user reached it: asking
 * for another link deleted the first, a capitalised address missed its own
 * account, and two consumers of one link could both be told yes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "crypto";

const execute = vi.fn();
const batch = vi.fn();
const queryOne = vi.fn();

vi.mock("@/lib/db/client", async () => ({
  ...(await import("../../helpers/db-mock")).createDbClientMock(),
  db: {
    execute: (...args: unknown[]) => execute(...args),
    batch: (...args: unknown[]) => batch(...args),
  },
  queryOne: (...args: unknown[]) => queryOne(...args),
}));

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

import { createMagicLink, verifyMagicLink } from "@/lib/auth";

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const inFuture = () => new Date(Date.now() + 10 * 60 * 1000).toISOString();

type Stmt = { sql: string; args: unknown[] };

describe("createMagicLink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    batch.mockResolvedValue([]);
  });

  it("keeps earlier unexpired links alive", async () => {
    await createMagicLink("owner@example.com", "https://app.example.com");
    const statements = batch.mock.calls[0][0] as Stmt[];
    const deletes = statements.filter((s) => /DELETE/i.test(s.sql));
    expect(deletes.length).toBeGreaterThan(0);
    for (const del of deletes) {
      // Every delete is conditional: spent or expired, or beyond the cap.
      expect(del.sql).toMatch(/used = TRUE|NOT IN/);
    }
  });

  it("stores and links the normalised address", async () => {
    const url = await createMagicLink("  Owner@Example.com ", "https://app.example.com/");
    const insert = (batch.mock.calls[0][0] as Stmt[]).find((s) => /INSERT/i.test(s.sql))!;
    expect(insert.args[0]).toBe("owner@example.com");
    expect(url).toMatch(/^https:\/\/app\.example\.com\/auth\/verify\?token=[0-9a-f]{64}&email=owner%40example\.com$/);
  });

  it("defaults to a 30-minute lifetime", async () => {
    const before = Date.now();
    await createMagicLink("owner@example.com", "https://app.example.com");
    const insert = (batch.mock.calls[0][0] as Stmt[]).find((s) => /INSERT/i.test(s.sql))!;
    const ttl = new Date(insert.args[2] as string).getTime() - before;
    expect(ttl).toBeGreaterThanOrEqual(30 * 60 * 1000 - 1000);
    expect(ttl).toBeLessThanOrEqual(30 * 60 * 1000 + 1000);
  });
});

describe("verifyMagicLink", () => {
  const token = "a".repeat(64);
  const user = { id: "user-1", email: "Owner@Example.com" };

  beforeEach(() => {
    vi.clearAllMocks();
    execute.mockResolvedValue({ rows: [], rowsAffected: 1 });
  });

  it("signs in an account stored with capitals from a lower-case link", async () => {
    queryOne
      .mockResolvedValueOnce({ id: "ml-1", email: "owner@example.com", token: hash(token), expires_at: inFuture(), used: 0 })
      .mockResolvedValueOnce(user);

    const result = await verifyMagicLink("owner@example.com", token);

    expect(result.ok).toBe(true);
    expect(queryOne.mock.calls[0][1]).toEqual([hash(token)]);
    expect(queryOne.mock.calls[1][0]).toMatch(/lower\(email\) = \?/);
  });

  it("tells the loser of a race that the link was used", async () => {
    queryOne.mockResolvedValueOnce({ id: "ml-1", email: "owner@example.com", expires_at: inFuture(), used: 0 });
    execute.mockResolvedValueOnce({ rows: [], rowsAffected: 0 });

    expect(await verifyMagicLink("owner@example.com", token)).toEqual({ ok: false, reason: "used" });
    // No session was created.
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("names an expired link without spending it", async () => {
    queryOne.mockResolvedValueOnce({
      id: "ml-1",
      email: "owner@example.com",
      expires_at: new Date(Date.now() - 1000).toISOString(),
      used: 0,
    });

    expect(await verifyMagicLink("owner@example.com", token)).toEqual({ ok: false, reason: "expired" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("refuses a link presented with another address", async () => {
    queryOne.mockResolvedValueOnce({ id: "ml-1", email: "owner@example.com", expires_at: inFuture(), used: 0 });

    expect(await verifyMagicLink("someone@example.com", token)).toEqual({ ok: false, reason: "invalid" });
    expect(execute).not.toHaveBeenCalled();
  });
});
