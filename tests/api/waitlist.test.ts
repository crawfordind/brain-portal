import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/db/client", async () => (await import("../helpers/db-mock")).createDbClientMock());
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, resetAt: 0 }),
}));
vi.mock("@/lib/email/index", () => ({
  sendEmail: vi.fn().mockResolvedValue(true),
  isEmailConfigured: vi.fn().mockReturnValue(true),
}));
vi.mock("@/lib/auth/admin", () => ({
  requireAdmin: vi.fn().mockResolvedValue({ id: "admin-1", email: "owner@example.com" }),
}));

import { db, queryOne } from "@/lib/db/client";
import { sendEmail, isEmailConfigured } from "@/lib/email/index";
import { POST as join } from "@/app/api/waitlist/route";
import { PATCH as review } from "@/app/api/admin/waitlist/route";
import { renderWaitlistApprovedEmail, renderWaitlistJoinedEmail } from "@/lib/waitlist/emails";

const execute = db.execute as unknown as ReturnType<typeof vi.fn>;
const one = queryOne as unknown as ReturnType<typeof vi.fn>;
const send = sendEmail as unknown as ReturnType<typeof vi.fn>;
const configured = isEmailConfigured as unknown as ReturnType<typeof vi.fn>;

function req(url: string, method: string, body: unknown) {
  return new NextRequest(`https://brain.example.com${url}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  execute.mockReset().mockResolvedValue({ rows: [], rowsAffected: 1 });
  one.mockReset().mockResolvedValue(null);
  send.mockReset().mockResolvedValue(true);
  configured.mockReset().mockReturnValue(true);
});

describe("POST /api/waitlist", () => {
  it("records a new address and confirms by email", async () => {
    const res = await join(req("/api/waitlist", "POST", { email: " New@Example.com " }));
    expect(res.status).toBe(200);
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ args: ["new@example.com"] })
    );
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: "new@example.com" }));
  });

  it("answers the same for an address already on the list, and sends nothing", async () => {
    one.mockResolvedValue({ id: "w1" });
    const res = await join(req("/api/waitlist", "POST", { email: "owner@example.com" }));
    expect(await res.json()).toEqual({ success: true });
    expect(execute).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("returns a JSON error the form can show when the database fails", async () => {
    execute.mockRejectedValue(new Error("no such table: waitlist"));
    const res = await join(req("/api/waitlist", "POST", { email: "new@example.com" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/try again/i);
    expect(body.error).not.toMatch(/table/);
  });

  it("rejects an address that is not one", async () => {
    const res = await join(req("/api/waitlist", "POST", { email: "nope" }));
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/admin/waitlist", () => {
  beforeEach(() => {
    one.mockResolvedValue({ id: "w1", email: "Guest@Example.com", status: "pending" });
  });

  it("creates the account on approval, so the person can actually sign in", async () => {
    const res = await review(req("/api/admin/waitlist", "PATCH", { id: "w1", status: "approved" }));
    expect(await res.json()).toEqual({ success: true, accountCreated: true, emailed: true });
    const insert = execute.mock.calls.find(([q]) => String(q.sql).startsWith("INSERT INTO users"));
    expect(insert?.[0].args).toEqual(["guest@example.com", "guest@example.com"]);
    expect(String(insert?.[0].sql)).toContain("NOT EXISTS");
  });

  it("says no email went out when SMTP is not configured", async () => {
    configured.mockReturnValue(false);
    const res = await review(req("/api/admin/waitlist", "PATCH", { id: "w1", status: "approved" }));
    expect((await res.json()).emailed).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("does not create an account on rejection", async () => {
    await review(req("/api/admin/waitlist", "PATCH", { id: "w1", status: "rejected" }));
    expect(execute.mock.calls.some(([q]) => String(q.sql).includes("INSERT INTO users"))).toBe(false);
  });

  it("refuses an unknown status and an unknown id", async () => {
    expect((await review(req("/api/admin/waitlist", "PATCH", { id: "w1", status: "vip" }))).status).toBe(400);
    one.mockResolvedValue(null);
    expect((await review(req("/api/admin/waitlist", "PATCH", { id: "zz", status: "approved" }))).status).toBe(404);
  });
});

describe("waitlist emails", () => {
  it("never names a person, promises training policy, or links a retired page", () => {
    for (const mail of [
      renderWaitlistJoinedEmail({ appUrl: "https://brain.example.com" }),
      renderWaitlistApprovedEmail({ appUrl: "https://brain.example.com", email: "a@example.com" }),
    ]) {
      const all = `${mail.subject}\n${mail.html}\n${mail.text}`;
      expect(all).not.toMatch(/\bDC\b/);
      expect(all).not.toMatch(/train/i);
      expect(all).not.toMatch(/graph/i);
    }
  });

  it("escapes the address and prefills it on the sign-in link", () => {
    const mail = renderWaitlistApprovedEmail({
      appUrl: "https://brain.example.com",
      email: 'x"<b>@example.com',
    });
    expect(mail.html).not.toContain("<b>@");
    expect(mail.text).toContain("/auth/login?email=x%22%3Cb%3E%40example.com");
  });
});
