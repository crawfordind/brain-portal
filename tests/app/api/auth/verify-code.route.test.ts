import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const verifySignInCode = vi.fn();

vi.mock("@/lib/auth", () => ({
  verifySignInCode: (...args: unknown[]) => verifySignInCode(...args),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(() => Promise.resolve({ allowed: true, limit: 10, remaining: 9, resetAt: Date.now() })),
}));

import { POST } from "@/app/api/auth/verify-code/route";

function post(body: unknown) {
  return new NextRequest("https://app.example.com/api/auth/verify-code", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/verify-code", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sets the session cookie on the right code", async () => {
    verifySignInCode.mockResolvedValue({ ok: true, user: { id: "u1" }, sessionToken: "d".repeat(64) });

    const res = await POST(post({ email: "owner@example.com", code: "123 456", redirect: "/notes" }));

    expect(verifySignInCode).toHaveBeenCalledWith("owner@example.com", "123 456");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, redirect: "/notes" });
    expect(res.headers.get("set-cookie")).toContain("brain_session=");
  });

  it.each(["https://evil.example", "//evil.example", "/\\evil.example"])(
    "never redirects off-site (%s)",
    async (redirect) => {
      verifySignInCode.mockResolvedValue({ ok: true, user: { id: "u1" }, sessionToken: "d".repeat(64) });
      const res = await POST(post({ email: "owner@example.com", code: "123456", redirect }));
      expect((await res.json()).redirect).toBe("/");
    }
  );

  it.each(["/login", "/Login/", "/signin?x=1", "/auth/login", "/auth/login?redirect=%2Fnotes", "/auth/verify"])(
    "never sends a signed-in user back to a sign-in page (%s)",
    async (redirect) => {
      verifySignInCode.mockResolvedValue({ ok: true, user: { id: "u1" }, sessionToken: "d".repeat(64) });
      const res = await POST(post({ email: "owner@example.com", code: "123456", redirect }));
      expect((await res.json()).redirect).toBe("/");
    }
  );

  it("keeps an ordinary page whose name merely starts like one", async () => {
    verifySignInCode.mockResolvedValue({ ok: true, user: { id: "u1" }, sessionToken: "d".repeat(64) });
    const res = await POST(post({ email: "owner@example.com", code: "123456", redirect: "/notes/login-ideas" }));
    expect((await res.json()).redirect).toBe("/notes/login-ideas");
  });

  it("explains a wrong code without setting a cookie", async () => {
    verifySignInCode.mockResolvedValue({ ok: false, reason: "wrong_code", attemptsLeft: 3 });

    const res = await POST(post({ email: "owner@example.com", code: "000000" }));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ reason: "wrong_code", attemptsLeft: 3 });
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("rejects a request missing the code", async () => {
    const res = await POST(post({ email: "owner@example.com" }));
    expect(res.status).toBe(400);
    expect(verifySignInCode).not.toHaveBeenCalled();
  });
});
