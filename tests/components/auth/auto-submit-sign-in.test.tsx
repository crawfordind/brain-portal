/**
 * Corporate mail scanners open sign-in links in a real browser that runs
 * JavaScript. A landing page that posted itself for anyone signed the scanner
 * in, so it now posts itself only in the browser that asked for the email.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { AutoSubmitSignIn } from "@/components/auth/auto-submit-sign-in";

describe("AutoSubmitSignIn", () => {
  const submit = vi.spyOn(HTMLFormElement.prototype, "requestSubmit").mockImplementation(() => {});

  afterEach(() => submit.mockClear());

  it("signs in by itself in the browser that asked for the email", () => {
    render(<AutoSubmitSignIn token="t" email="owner@example.com" auto />);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("waits for a press anywhere else, and offers the code instead", () => {
    render(<AutoSubmitSignIn token="t" email="owner@example.com" auto={false} />);

    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
    const link = screen.getByRole("link", { name: /sign-in screen/ });
    expect(link.getAttribute("href")).toBe("/auth/login?email=owner%40example.com&step=code");
  });
});
