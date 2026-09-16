/**
 * Tests for the MCP tool-call guard (scope + rate-limit).
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  createToolContext,
  errorResult,
  runGuard,
} from "@/mcp/guard";
import { resetRateLimits } from "@/mcp/rate-limit";
import type { AuthenticatedUser } from "@/mcp/auth";

function user(
  overrides: Partial<AuthenticatedUser> = {}
): AuthenticatedUser {
  return {
    userId: "u1",
    keyId: "key-xyz",
    keyName: "Test key",
    scopes: ["notes:read", "tasks:write"],
    rateLimitPerMinute: 60,
    ...overrides,
  };
}

describe("runGuard", () => {
  beforeEach(() => resetRateLimits());

  it("passes when scope is held and bucket has tokens", () => {
    const result = runGuard(user(), "notes:read");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.userId).toBe("u1");
      expect(result.rateLimit.limit).toBe(60);
    }
  });

  it("accepts wildcard scope", () => {
    const result = runGuard(user({ scopes: ["*"] }), "anything:here");
    expect(result.ok).toBe(true);
  });

  it("rejects with scope error when scope is missing", () => {
    const result = runGuard(user({ scopes: ["notes:read"] }), "tasks:write");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe("scope");
      expect(result.error.scope).toBe("tasks:write");
      expect(result.error.message).toContain("tasks:write");
    }
  });

  it("does NOT consume a rate-limit token on scope failure", () => {
    const u = user({ scopes: ["notes:read"], rateLimitPerMinute: 1 });
    // First call fails for scope — should not consume a token.
    expect(runGuard(u, "tasks:write").ok).toBe(false);
    // Now a call with a held scope should succeed.
    expect(runGuard(u, "notes:read").ok).toBe(true);
    // And the next should be rate-limited.
    const third = runGuard(u, "notes:read");
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.error.type).toBe("rate_limit");
  });

  it("rejects with rate_limit error when bucket is empty", () => {
    const u = user({ rateLimitPerMinute: 1 });
    expect(runGuard(u, "notes:read").ok).toBe(true);
    const denied = runGuard(u, "notes:read");
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.error.type).toBe("rate_limit");
      expect(denied.error.retryAfterMs).toBeGreaterThan(0);
      expect(denied.error.message).toContain("Rate limit");
    }
  });
});

describe("createToolContext", () => {
  beforeEach(() => resetRateLimits());

  it("exposes getUser, getUserId, and guard", () => {
    const u = user();
    const ctx = createToolContext(() => u);
    expect(ctx.getUser()).toBe(u);
    expect(ctx.getUserId()).toBe("u1");
    expect(ctx.guard("notes:read").ok).toBe(true);
  });
});

describe("errorResult", () => {
  it("encodes scope errors as an MCP tool result", () => {
    const result = errorResult({
      ok: false,
      userId: "u1",
      error: { type: "scope", scope: "tasks:write", message: "nope" },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].type).toBe("text");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe("scope");
    expect(parsed.scope).toBe("tasks:write");
    expect(parsed.message).toBe("nope");
  });

  it("encodes rate_limit errors with retry_after_ms", () => {
    const result = errorResult({
      ok: false,
      userId: "u1",
      error: {
        type: "rate_limit",
        retryAfterMs: 1234,
        message: "slow down",
      },
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe("rate_limit");
    expect(parsed.retry_after_ms).toBe(1234);
  });
});
