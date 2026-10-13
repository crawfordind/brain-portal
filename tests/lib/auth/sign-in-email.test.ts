import { describe, it, expect } from "vitest";
import { renderSignInEmail } from "@/lib/auth/sign-in-email";
import { formatSignInCode, normalizeSignInCode } from "@/lib/auth/magic-link";

const URL_ = "https://app.example.com/auth/verify?token=abc&email=owner%40example.com";

describe("renderSignInEmail", () => {
  it("puts the code in the subject, so a phone notification is enough", () => {
    const email = renderSignInEmail({ url: URL_, code: "042917", lifetime: "30 minutes" });
    expect(email.subject).toBe("042 917 is your Brain Portal sign-in code");
  });

  it("carries both the code and the link, in HTML and plain text", () => {
    const email = renderSignInEmail({ url: URL_, code: "042917", lifetime: "30 minutes" });
    expect(email.html).toContain("042 917");
    expect(email.html).toContain("token=abc");
    expect(email.text).toContain("Your sign-in code: 042 917");
    expect(email.text).toContain(URL_);
    expect(email.text).toContain("expire in 30 minutes");
  });

  it("falls back to a link-only email when no code could be stored", () => {
    const email = renderSignInEmail({ url: URL_, code: null, lifetime: "30 minutes" });
    expect(email.subject).toBe("Sign in to Brain Portal");
    expect(email.text).not.toMatch(/code:/);
    expect(email.text).toContain(URL_);
  });
});

describe("sign-in code formatting", () => {
  it("accepts the code however it was typed or pasted", () => {
    expect(normalizeSignInCode(" 042 917\n")).toBe("042917");
    expect(normalizeSignInCode("042-917")).toBe("042917");
  });

  it("groups six digits for reading off one screen", () => {
    expect(formatSignInCode("042917")).toBe("042 917");
  });
});
