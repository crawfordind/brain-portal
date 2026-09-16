/**
 * Tests for the Next.js-side MCP key management library
 * (`src/lib/mcp/keys.ts`).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "crypto";

// Mock the shared Turso client that keys.ts uses.
vi.mock("@/lib/db/client", () => {
  const query = vi.fn();
  const queryOne = vi.fn();
  const db = { execute: vi.fn() };
  return { query, queryOne, db };
});

import {
  createKeyForUser,
  listKeysForUser,
  revokeKeyForUser,
  validateScopes,
  MCP_SCOPES,
} from "@/lib/mcp/keys";
import { query, queryOne, db } from "@/lib/db/client";

const mockQuery = vi.mocked(query);
const mockQueryOne = vi.mocked(queryOne);
const mockExecute = vi.mocked(db.execute);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("validateScopes", () => {
  it("accepts the wildcard scope", () => {
    expect(validateScopes(["*"])).toEqual(["*"]);
  });

  it("accepts a list of canonical scopes", () => {
    const scopes = ["notes:read", "tasks:write"];
    expect(validateScopes(scopes)).toEqual(scopes);
  });

  it("rejects an empty list", () => {
    expect(validateScopes([])).toBeNull();
  });

  it("rejects non-arrays", () => {
    expect(validateScopes("notes:read")).toBeNull();
    expect(validateScopes(null)).toBeNull();
  });

  it("rejects unknown scopes", () => {
    expect(validateScopes(["notes:read", "not-a-scope"])).toBeNull();
  });
});

describe("createKeyForUser", () => {
  it("inserts a SHA-256-hashed key and returns plaintext once", async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: "key-1",
      user_id: "u1",
      name: "Test key",
      key_prefix: "bp_mcp_abcd",
      scopes: '["*"]',
      is_active: 1,
      rate_limit_per_minute: 60,
      last_used_at: null,
      expires_at: null,
      created_at: "2026-01-01",
    });

    const { key, summary } = await createKeyForUser("u1", {
      name: "Test key",
    });

    expect(key).toMatch(/^bp_mcp_[a-f0-9]{64}$/);
    expect(summary.id).toBe("key-1");
    expect(summary.is_active).toBe(true);
    expect(summary.scopes).toEqual(["*"]);

    // The INSERT must contain the hashed key, not the raw one.
    const [sql, args] = mockQueryOne.mock.calls[0] as [
      string,
      Array<string | number | null>,
    ];
    expect(sql).toMatch(/INSERT INTO mcp_api_keys/);
    const expectedHash = createHash("sha256").update(key).digest("hex");
    expect(args).toContain(expectedHash);
    expect(args).not.toContain(key);
  });

  it("defaults scopes to wildcard and rate-limit to 60", async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: "key-2",
      user_id: "u1",
      name: "k",
      key_prefix: "bp_mcp_ffff",
      scopes: '["*"]',
      is_active: 1,
      rate_limit_per_minute: 60,
      last_used_at: null,
      expires_at: null,
      created_at: "2026-01-01",
    });

    await createKeyForUser("u1", { name: "k" });

    const [, args] = mockQueryOne.mock.calls[0] as [
      string,
      Array<string | number | null>,
    ];
    expect(args).toContain('["*"]');
    expect(args).toContain(60);
  });

  it("sets an expiry when expiresInDays is provided", async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: "key-3",
      user_id: "u1",
      name: "k",
      key_prefix: "bp_mcp_ffff",
      scopes: '["notes:read"]',
      is_active: 1,
      rate_limit_per_minute: 30,
      last_used_at: null,
      expires_at: "2026-02-01T00:00:00.000Z",
      created_at: "2026-01-01",
    });

    await createKeyForUser("u1", {
      name: "k",
      scopes: ["notes:read"],
      rateLimitPerMinute: 30,
      expiresInDays: 30,
    });

    const [, args] = mockQueryOne.mock.calls[0] as [
      string,
      Array<string | number | null>,
    ];
    const expiresAt = args[args.length - 1];
    expect(typeof expiresAt).toBe("string");
    expect(new Date(expiresAt as string).getTime()).toBeGreaterThan(Date.now());
  });
});

describe("listKeysForUser", () => {
  it("parses scopes JSON and coerces is_active to boolean", async () => {
    mockQuery.mockResolvedValueOnce([
      {
        id: "k1",
        user_id: "u1",
        name: "A",
        key_prefix: "bp_mcp_aaaa",
        scopes: '["notes:read"]',
        is_active: 1,
        rate_limit_per_minute: 60,
        last_used_at: null,
        expires_at: null,
        created_at: "2026-01-01",
      },
      {
        id: "k2",
        user_id: "u1",
        name: "B",
        key_prefix: "bp_mcp_bbbb",
        scopes: '["*"]',
        is_active: 0,
        rate_limit_per_minute: 10,
        last_used_at: null,
        expires_at: null,
        created_at: "2025-12-01",
      },
    ]);

    const keys = await listKeysForUser("u1");
    expect(keys).toHaveLength(2);
    expect(keys[0].is_active).toBe(true);
    expect(keys[0].scopes).toEqual(["notes:read"]);
    expect(keys[1].is_active).toBe(false);
    expect(keys[1].scopes).toEqual(["*"]);
  });
});

describe("revokeKeyForUser", () => {
  it("returns false when key doesn't exist", async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    const result = await revokeKeyForUser("u1", "missing");
    expect(result).toBe(false);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("marks the key inactive when owned by the user", async () => {
    mockQueryOne.mockResolvedValueOnce({ id: "k1" });
    const result = await revokeKeyForUser("u1", "k1");
    expect(result).toBe(true);
    expect(mockExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining("is_active = FALSE"),
        args: ["k1", "u1"],
      })
    );
  });
});

describe("MCP_SCOPES", () => {
  it("includes all expected tool scopes", () => {
    for (const expected of [
      "notes:read",
      "notes:write",
      "tasks:read",
      "tasks:write",
      "projects:read",
      "projects:write",
      "captures:read",
      "captures:write",
      "search:read",
      "ai:search",
      "ai:insights",
      "ai:delegate",
      "resources:read",
      "prompts:read",
    ]) {
      expect(MCP_SCOPES).toContain(expected);
    }
  });
});
