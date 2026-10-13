/**
 * `/api/auth/verify`. The bug this pins: mail scanners fetch every link in a
 * message before the recipient does, and a GET used to spend the one-time
 * sign-in link. The person's own click then hit "expired or already used".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const verifyMagicLink = vi.fn();
const getCurrentUser = vi.fn();

vi.mock("@/lib/auth", () => ({
  verifyMagicLink: (...args: unknown[]) => verifyMagicLink(...args),
  getCurrentUser: (...args: unknown[]) => getCurrentUser(...args),
}));
vi.mock("@/lib/collaborators", () => ({ acceptProjectInvite: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(() => Promise.resolve({ allowed: true, limit: 10, remaining: 9, resetAt: Date.now() })),
}));

import { GET, POST } from "@/app/api/auth/verify/route";

const TOKEN = "b".repeat(64);

function post(fields: Record<string, string>) {
  return new NextRequest("https://app.example.com/api/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
}

describe("GET /api/auth/verify", () => {
  beforeEach(() => vi.clearAllMocks());

  it("never spends the link; it sends the browser to the confirm page", async () => {
    const res = await GET(
      new NextRequest(`https://app.example.com/api/auth/verify?token=${TOKEN}&email=owner%40example.com&invite=inv1`)
    );

    expect(verifyMagicLink).not.toHaveBeenCalled();
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/auth/verify");
    expect(location.searchParams.get("token")).toBe(TOKEN);
    expect(location.searchParams.get("email")).toBe("owner@example.com");
    expect(location.searchParams.get("invite")).toBe("inv1");
  });
});

describe("POST /api/auth/verify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentUser.mockResolvedValue(null);
  });

  it("signs in from the form and sets the session cookie", async () => {
    verifyMagicLink.mockResolvedValue({
      ok: true,
      user: { id: "user-1", email: "owner@example.com" },
      sessionToken: "c".repeat(64),
    });

    const res = await POST(post({ token: TOKEN, email: "owner@example.com" }));

    expect(verifyMagicLink).toHaveBeenCalledWith("owner@example.com", TOKEN);
    expect(res.status).toBe(303);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/");
    expect(res.headers.get("set-cookie")).toContain("brain_session=");
  });

  it.each([
    ["expired", "link_expired"],
    ["used", "link_used"],
    ["invalid", "invalid_token"],
    ["not_allowed", "not_allowed"],
  ])("explains a %s link", async (reason, code) => {
    verifyMagicLink.mockResolvedValue({ ok: false, reason });

    const res = await POST(post({ token: TOKEN, email: "owner@example.com" }));

    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/auth/error");
    expect(location.searchParams.get("reason")).toBe(code);
  });

  it("lets a second click through when this browser is already signed in as that address", async () => {
    verifyMagicLink.mockResolvedValue({ ok: false, reason: "used" });
    getCurrentUser.mockResolvedValue({ id: "user-1", email: "Owner@Example.com" });

    const res = await POST(post({ token: TOKEN, email: "owner@example.com" }));

    expect(new URL(res.headers.get("location")!).pathname).toBe("/");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("does not wave through a signed-in browser for a different address", async () => {
    verifyMagicLink.mockResolvedValue({ ok: false, reason: "used" });
    getCurrentUser.mockResolvedValue({ id: "user-2", email: "someone@example.com" });

    const res = await POST(post({ token: TOKEN, email: "owner@example.com" }));

    expect(new URL(res.headers.get("location")!).pathname).toBe("/auth/error");
  });

  it("rejects a form missing its token", async () => {
    const res = await POST(post({ email: "owner@example.com" }));
    expect(new URL(res.headers.get("location")!).searchParams.get("reason")).toBe("missing_params");
    expect(verifyMagicLink).not.toHaveBeenCalled();
  });
});
