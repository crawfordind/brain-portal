/**
 * Tests for MCP Database module
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @libsql/client
vi.mock("@libsql/client", () => ({
  createClient: vi.fn(() => ({
    execute: vi.fn().mockResolvedValue({
      rows: [{ id: "1", name: "test" }],
    }),
  })),
}));

describe("MCP Database", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("throws when TURSO_DATABASE_URL is not set", async () => {
    delete process.env.TURSO_DATABASE_URL;

    // Re-import to get fresh module
    const mod = await import("@/mcp/db");
    await expect(mod.query("SELECT 1")).rejects.toThrow(
      "TURSO_DATABASE_URL is not set"
    );
  });

  it("query returns mapped rows", async () => {
    process.env.TURSO_DATABASE_URL = "libsql://test.turso.io";
    process.env.TURSO_AUTH_TOKEN = "test-token";

    const mod = await import("@/mcp/db");
    const results = await mod.query<{ id: string; name: string }>(
      "SELECT * FROM test"
    );

    expect(results).toEqual([{ id: "1", name: "test" }]);
  });

  it("queryOne returns first result or null", async () => {
    process.env.TURSO_DATABASE_URL = "libsql://test.turso.io";
    process.env.TURSO_AUTH_TOKEN = "test-token";

    const mod = await import("@/mcp/db");
    const result = await mod.queryOne<{ id: string }>("SELECT * FROM test");
    expect(result).toEqual({ id: "1", name: "test" });
  });
});
