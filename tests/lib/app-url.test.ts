import { describe, it, expect } from "vitest";
import { absoluteUrl, getAppUrl, hasPublicAppUrl, normalizeOrigin } from "@/lib/app-url";

describe("getAppUrl", () => {
  it("prefers the runtime APP_URL over the build-time NEXT_PUBLIC_APP_URL", () => {
    const env = { APP_URL: "https://brain.example.com", NEXT_PUBLIC_APP_URL: "https://old.example.com" };
    expect(getAppUrl({ env })).toBe("https://brain.example.com");
  });

  it("uses Vercel's production domain when nothing is configured (the localhost-email bug)", () => {
    const env = {
      NODE_ENV: "production",
      VERCEL_ENV: "production",
      VERCEL_PROJECT_PRODUCTION_URL: "brain.example.com",
      VERCEL_URL: "brain-abc123.vercel.app",
    };
    expect(getAppUrl({ env })).toBe("https://brain.example.com");
  });

  it("skips a localhost value copied into production", () => {
    const env = {
      NODE_ENV: "production",
      VERCEL_ENV: "production",
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      VERCEL_PROJECT_PRODUCTION_URL: "brain.example.com",
    };
    expect(getAppUrl({ env })).toBe("https://brain.example.com");
  });

  it("lets a preview deployment link to itself, not to production", () => {
    const env = {
      NODE_ENV: "production",
      VERCEL_ENV: "preview",
      VERCEL_PROJECT_PRODUCTION_URL: "brain.example.com",
      VERCEL_URL: "brain-git-feature.vercel.app",
    };
    expect(getAppUrl({ env })).toBe("https://brain-git-feature.vercel.app");
  });

  it("falls back to the request origin before VERCEL_URL", () => {
    expect(getAppUrl({ env: {}, requestOrigin: "https://req.example.com" })).toBe("https://req.example.com");
  });

  it("uses localhost in development only as the last resort", () => {
    expect(getAppUrl({ env: { NODE_ENV: "development" } })).toBe("http://localhost:3000");
    expect(hasPublicAppUrl({ env: { NODE_ENV: "development" } })).toBe(false);
  });

  it("strips trailing slashes and ignores garbage", () => {
    expect(normalizeOrigin("https://a.example.com/")).toBe("https://a.example.com");
    expect(normalizeOrigin("  ")).toBeNull();
    expect(normalizeOrigin("javascript:alert(1)")).toBeNull();
    expect(normalizeOrigin("localhost:3000")).toBe("http://localhost:3000");
  });
});

describe("absoluteUrl", () => {
  it("joins paths onto the resolved origin", () => {
    const env = { APP_URL: "https://brain.example.com/" };
    expect(absoluteUrl("/tasks?task=1", { env })).toBe("https://brain.example.com/tasks?task=1");
    expect(absoluteUrl("tasks", { env })).toBe("https://brain.example.com/tasks");
    expect(absoluteUrl("https://other.example.com/x", { env })).toBe("https://other.example.com/x");
  });
});
