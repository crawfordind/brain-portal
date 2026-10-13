/**
 * Limits with different buckets must not share a counter. They used to: the
 * key was the client IP alone, so chatting used up the sign-in budget.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("next/headers", () => ({
  headers: vi.fn(() => Promise.resolve(new Headers({ "x-forwarded-for": "203.0.113.7" }))),
}));

import { checkRateLimit } from "@/lib/rate-limit";

describe("checkRateLimit buckets", () => {
  it("keeps separate counts per bucket", async () => {
    for (let i = 0; i < 20; i++) {
      await checkRateLimit({ bucket: "test-chat", maxRequests: 60, windowMs: 60_000 });
    }

    const login = await checkRateLimit({ bucket: "test-login", maxRequests: 5, windowMs: 60_000 });
    expect(login.allowed).toBe(true);
    expect(login.remaining).toBe(4);
  });

  it("still limits within one bucket", async () => {
    let last = { allowed: true };
    for (let i = 0; i < 3; i++) {
      last = await checkRateLimit({ bucket: "test-tight", maxRequests: 2, windowMs: 60_000 });
    }
    expect(last.allowed).toBe(false);
  });
});
