/**
 * Tests for the MCP token-bucket rate limiter.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  consumeRateLimit,
  resetRateLimits,
  peekBucket,
} from "@/mcp/rate-limit";
import type { AuthenticatedUser } from "@/mcp/auth";

function user(
  overrides: Partial<AuthenticatedUser> = {}
): AuthenticatedUser {
  return {
    userId: "u1",
    keyId: "key-abc",
    keyName: "Test key",
    scopes: ["*"],
    rateLimitPerMinute: 60,
    ...overrides,
  };
}

describe("consumeRateLimit", () => {
  beforeEach(() => {
    resetRateLimits();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows calls under the per-minute ceiling", () => {
    const u = user({ rateLimitPerMinute: 5 });
    for (let i = 0; i < 5; i++) {
      const r = consumeRateLimit(u);
      expect(r.allowed).toBe(true);
      expect(r.limit).toBe(5);
    }
    const remaining = peekBucket(u.keyId)!.tokens;
    expect(remaining).toBeLessThan(1);
  });

  it("rejects once the bucket is empty and reports retry time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    const u = user({ rateLimitPerMinute: 2 });
    expect(consumeRateLimit(u).allowed).toBe(true);
    expect(consumeRateLimit(u).allowed).toBe(true);

    const denied = consumeRateLimit(u);
    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
    expect(denied.limit).toBe(2);
  });

  it("refills continuously based on elapsed time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    // 60/min = 1 token per 1000ms
    const u = user({ rateLimitPerMinute: 60 });

    // Drain the bucket.
    for (let i = 0; i < 60; i++) {
      expect(consumeRateLimit(u).allowed).toBe(true);
    }
    expect(consumeRateLimit(u).allowed).toBe(false);

    // Advance 2 seconds → ~2 tokens refilled.
    vi.advanceTimersByTime(2000);

    expect(consumeRateLimit(u).allowed).toBe(true);
    expect(consumeRateLimit(u).allowed).toBe(true);
    expect(consumeRateLimit(u).allowed).toBe(false);
  });

  it("resets the bucket when the per-minute limit changes", () => {
    const u = user({ rateLimitPerMinute: 5 });
    consumeRateLimit(u);
    const before = peekBucket(u.keyId)!;
    expect(before.capacity).toBe(5);

    // Same key, larger limit → new bucket at new capacity.
    const upgraded = { ...u, rateLimitPerMinute: 100 };
    consumeRateLimit(upgraded);
    const after = peekBucket(u.keyId)!;
    expect(after.capacity).toBe(100);
  });

  it("isolates buckets between keys", () => {
    const a = user({ keyId: "key-a", rateLimitPerMinute: 1 });
    const b = user({ keyId: "key-b", rateLimitPerMinute: 1 });

    expect(consumeRateLimit(a).allowed).toBe(true);
    // `a` is drained, but `b` should still have a full bucket.
    expect(consumeRateLimit(a).allowed).toBe(false);
    expect(consumeRateLimit(b).allowed).toBe(true);
  });

  it("bypasses the limiter for the dev-fallback key", () => {
    const dev = user({ keyId: "dev-fallback", rateLimitPerMinute: 1 });
    for (let i = 0; i < 50; i++) {
      expect(consumeRateLimit(dev).allowed).toBe(true);
    }
  });
});
