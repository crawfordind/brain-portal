import { describe, it, expect } from "vitest";
import { createEmailActionToken, verifyEmailActionToken } from "@/lib/email/action-tokens";

describe("email action tokens", () => {
  it("round-trips a payload", () => {
    const token = createEmailActionToken({ u: "user-1", a: "task_complete", id: "task-1" })!;
    const result = verifyEmailActionToken(token);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload).toMatchObject({ u: "user-1", a: "task_complete", id: "task-1" });
    }
  });

  it("rejects a token whose payload was edited", () => {
    const token = createEmailActionToken({ u: "user-1", a: "task_complete", id: "task-1" })!;
    const [v, , sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ u: "user-2", a: "task_complete", id: "task-1", exp: 9e9 })).toString("base64url");
    expect(verifyEmailActionToken(`${v}.${forged}.${sig}`)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects an expired token", () => {
    const issuedAt = Date.now() - 20 * 24 * 60 * 60 * 1000;
    const token = createEmailActionToken({ u: "u", a: "task_complete", id: "t" }, 60, issuedAt)!;
    expect(verifyEmailActionToken(token)).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects malformed input without throwing", () => {
    expect(verifyEmailActionToken(null).ok).toBe(false);
    expect(verifyEmailActionToken("nope").ok).toBe(false);
    expect(verifyEmailActionToken("v1.%%%.abc").ok).toBe(false);
    expect(verifyEmailActionToken("x".repeat(5000)).ok).toBe(false);
  });

  it("fails closed without a secret", () => {
    const saved = { s: process.env.SESSION_SECRET, e: process.env.EMAIL_ACTION_SECRET };
    delete process.env.SESSION_SECRET;
    delete process.env.EMAIL_ACTION_SECRET;
    try {
      expect(createEmailActionToken({ u: "u", a: "task_complete", id: "t" })).toBeNull();
      expect(verifyEmailActionToken("v1.a.b")).toEqual({ ok: false, reason: "unconfigured" });
    } finally {
      process.env.SESSION_SECRET = saved.s;
      if (saved.e) process.env.EMAIL_ACTION_SECRET = saved.e;
    }
  });
});
