/**
 * `/api/auth/login` marks the browser that asked for the email, so the link
 * can tell that browser apart from a mail scanner opening it first.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const createSignIn = vi.fn();
const queryOne = vi.fn();
const mayCreateAccount = vi.fn();

vi.mock("@/lib/auth", () => ({ createSignIn: (...args: unknown[]) => createSignIn(...args) }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(() => Promise.resolve(true)), isEmailConfigured: () => true }));
vi.mock("@/lib/auth/signup-policy", () => ({ mayCreateAccount: (...args: unknown[]) => mayCreateAccount(...args) }));
vi.mock("@/lib/db/client", async () => ({
  ...(await import("../../../helpers/db-mock")).createDbClientMock(),
  queryOne: (...args: unknown[]) => queryOne(...args),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(() => Promise.resolve({ allowed: true, limit: 5, remaining: 4, resetAt: Date.now() })),
}));

import { POST } from "@/app/api/auth/login/route";

function login(cookie?: string) {
  return new NextRequest("https://app.example.com/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify({ email: "Owner@Example.com" }),
  });
}

function browserCookie(res: Response): string | undefined {
  const header = res.headers.get("set-cookie") || "";
  return header.match(/brain_signin_browser=([0-9a-f]+)/)?.[1];
}

describe("POST /api/auth/login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryOne.mockResolvedValue({ id: "user-1" });
    createSignIn.mockResolvedValue({ url: "https://app.example.com/auth/verify?token=t", code: "123456" });
  });

  it("binds the link to this browser with an httpOnly cookie", async () => {
    const res = await POST(login());

    const secret = browserCookie(res);
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(res.headers.get("set-cookie")).toMatch(/HttpOnly/i);
    expect(createSignIn).toHaveBeenCalledWith("owner@example.com", expect.objectContaining({ browserSecret: secret }));
  });

  it("keeps the browser's existing secret, so every email it asked for is recognised", async () => {
    const existing = "a".repeat(64);
    const res = await POST(login(`brain_signin_browser=${existing}`));

    expect(browserCookie(res)).toBe(existing);
    expect(createSignIn).toHaveBeenCalledWith("owner@example.com", expect.objectContaining({ browserSecret: existing }));
  });

  it("replaces a malformed secret rather than trusting it", async () => {
    const res = await POST(login("brain_signin_browser=not-hex"));
    expect(browserCookie(res)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("answers an address it will not sign in exactly like one it will", async () => {
    queryOne.mockResolvedValue(null);
    mayCreateAccount.mockReturnValue(false);

    const res = await POST(login());

    expect(createSignIn).not.toHaveBeenCalled();
    expect(browserCookie(res)).toMatch(/^[0-9a-f]{64}$/);
    expect(await res.json()).toMatchObject({ success: true, hasCode: true });
  });
});
