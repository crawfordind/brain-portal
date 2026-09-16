/**
 * Tests for MCP Authentication module
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the database module before importing auth
vi.mock("@/mcp/db", () => {
  const mockQuery = vi.fn();
  const mockQueryOne = vi.fn();
  const mockDb = {
    execute: vi.fn(),
  };
  return {
    db: mockDb,
    query: mockQuery,
    queryOne: mockQueryOne,
    mutate: vi.fn(),
  };
});

import { validateApiKey, hasScope, authenticateFromEnv } from "@/mcp/auth";
import { queryOne, db } from "@/mcp/db";
import { createHash } from "crypto";

const mockQueryOne = vi.mocked(queryOne);
const mockDbExecute = vi.mocked(db.execute);

describe("MCP Auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear env vars
    delete process.env.MCP_API_KEY;
    delete process.env.MCP_USER_ID;
  });

  describe("validateApiKey", () => {
    it("returns null for invalid key", async () => {
      mockQueryOne.mockResolvedValue(null);
      const result = await validateApiKey("invalid_key");
      expect(result).toBeNull();
    });

    it("returns user context for valid key", async () => {
      const testKey = "bp_mcp_testkey123";
      const keyHash = createHash("sha256").update(testKey).digest("hex");

      mockQueryOne.mockResolvedValue({
        id: "key-1",
        user_id: "user-1",
        name: "Test Key",
        key_hash: keyHash,
        key_prefix: "bp_mcp_test",
        scopes: '["*"]',
        is_active: 1,
        rate_limit_per_minute: 60,
        last_used_at: null,
        expires_at: null,
        created_at: "2024-01-01",
      });

      const result = await validateApiKey(testKey);

      expect(result).not.toBeNull();
      expect(result!.userId).toBe("user-1");
      expect(result!.keyId).toBe("key-1");
      expect(result!.keyName).toBe("Test Key");
      expect(result!.scopes).toEqual(["*"]);

      // Should update last_used_at
      expect(mockDbExecute).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE mcp_api_keys"),
        ["key-1"]
      );
    });
  });

  describe("hasScope", () => {
    it("returns true for wildcard scope", () => {
      const user = {
        userId: "u1",
        keyId: "k1",
        keyName: "test",
        scopes: ["*"],
        rateLimitPerMinute: 60,
      };
      expect(hasScope(user, "notes:read")).toBe(true);
      expect(hasScope(user, "anything")).toBe(true);
    });

    it("returns true for matching scope", () => {
      const user = {
        userId: "u1",
        keyId: "k1",
        keyName: "test",
        scopes: ["notes:read", "tasks:write"],
        rateLimitPerMinute: 60,
      };
      expect(hasScope(user, "notes:read")).toBe(true);
      expect(hasScope(user, "tasks:write")).toBe(true);
    });

    it("returns false for missing scope", () => {
      const user = {
        userId: "u1",
        keyId: "k1",
        keyName: "test",
        scopes: ["notes:read"],
        rateLimitPerMinute: 60,
      };
      expect(hasScope(user, "tasks:write")).toBe(false);
    });
  });

  describe("authenticateFromEnv", () => {
    it("throws when no credentials provided", async () => {
      await expect(authenticateFromEnv()).rejects.toThrow(
        "Authentication required"
      );
    });

    it("authenticates with MCP_USER_ID in dev mode", async () => {
      process.env.MCP_USER_ID = "user-123";
      mockQueryOne.mockResolvedValue({ id: "user-123" });

      const result = await authenticateFromEnv();
      expect(result.userId).toBe("user-123");
      expect(result.keyName).toBe("Development Mode");
      expect(result.scopes).toEqual(["*"]);
    });

    it("throws for invalid MCP_USER_ID", async () => {
      process.env.MCP_USER_ID = "nonexistent";
      mockQueryOne.mockResolvedValue(null);

      await expect(authenticateFromEnv()).rejects.toThrow("not found");
    });

    it("authenticates with MCP_API_KEY", async () => {
      process.env.MCP_API_KEY = "bp_mcp_testkey";
      mockQueryOne.mockResolvedValue({
        id: "key-1",
        user_id: "user-1",
        name: "API Key",
        scopes: '["*"]',
        is_active: 1,
        rate_limit_per_minute: 60,
        last_used_at: null,
        expires_at: null,
        created_at: "2024-01-01",
      });

      const result = await authenticateFromEnv();
      expect(result.userId).toBe("user-1");
    });

    it("throws for invalid MCP_API_KEY", async () => {
      process.env.MCP_API_KEY = "invalid_key";
      mockQueryOne.mockResolvedValue(null);

      await expect(authenticateFromEnv()).rejects.toThrow("Invalid or expired");
    });
  });
});
