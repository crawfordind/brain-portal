import { describe, it, expect } from "vitest";
import { capabilitiesOf, getRuntimeConfig, publicRuntimeStatus } from "@/lib/agents/runtime/config";

const KEY = "k".repeat(32);
const hermes = {
  AGENT_RUNTIME: "hermes",
  HERMES_URL: "https://agent.example.com/p/my-profile/",
  HERMES_API_KEY: KEY,
  NODE_ENV: "production",
};

describe("getRuntimeConfig: choosing a runtime", () => {
  it("defaults to OpenRouter, so a fresh install with only an OpenRouter key works", () => {
    const c = getRuntimeConfig({ OPENROUTER_API_KEY: "sk-or-test" });
    expect(c).toMatchObject({ runtime: "openrouter", state: "ready", hermes: null });
  });

  it("reports OpenRouter as misconfigured, not silently ready, without a key", () => {
    const c = getRuntimeConfig({});
    expect(c.state).toBe("misconfigured");
    expect(c.reason).toMatch(/OPENROUTER_API_KEY is not set/);
  });

  it("can be turned off, with an honest reason", () => {
    const c = getRuntimeConfig({ AGENT_RUNTIME: "off", OPENROUTER_API_KEY: "sk-or-test" });
    expect(c).toMatchObject({ runtime: null, state: "disabled" });
    expect(c.reason).toMatch(/AGENT_RUNTIME=off/);
  });

  it("refuses an unknown runtime instead of guessing one", () => {
    const c = getRuntimeConfig({ AGENT_RUNTIME: "something-else", OPENROUTER_API_KEY: "sk-or-test" });
    expect(c).toMatchObject({ runtime: null, state: "misconfigured" });
  });

  it("does not fall back to OpenRouter when Hermes is chosen but misconfigured", () => {
    const c = getRuntimeConfig({ AGENT_RUNTIME: "hermes", OPENROUTER_API_KEY: "sk-or-test" });
    expect(c.state).toBe("misconfigured");
    expect(c.runtime).toBe("hermes");
    expect(c.reason).toMatch(/HERMES_URL is not set/);
  });

  it("uses a generic display name unless one is configured, and sanitises it", () => {
    expect(getRuntimeConfig({}).displayName).toBe("Agent");
    expect(getRuntimeConfig({ AGENT_DISPLAY_NAME: "  Robin " }).displayName).toBe("Robin");
    expect(getRuntimeConfig({ AGENT_DISPLAY_NAME: "<b>x</b>" }).displayName).toBe("bx/b");
  });
});

describe("getRuntimeConfig: Hermes", () => {
  it("is ready with an https URL and a strong key; trims the trailing slash", () => {
    const c = getRuntimeConfig(hermes);
    expect(c.state).toBe("ready");
    expect(c.hermes?.baseUrl).toBe("https://agent.example.com/p/my-profile");
    expect(c.hermes?.profile).toBeNull();
  });

  it.each([
    [{ HERMES_URL: "" }, /HERMES_URL is not set/],
    [{ HERMES_URL: "not a url" }, /not a valid URL/],
    [{ HERMES_URL: "http://agent.example.com" }, /must use https/],
    [{ HERMES_URL: "http://127.0.0.1:8642" }, /must use https/],
    [{ HERMES_URL: "https://user:pass@agent.example.com" }, /must not contain credentials/],
    [{ HERMES_URL: "https://agent.example.com/?key=x" }, /query string/],
    [{ HERMES_API_KEY: "" }, /HERMES_API_KEY is not set/],
    [{ HERMES_API_KEY: "short" }, /shorter than 16/],
    [{ HERMES_EDGE_CLIENT_ID: "id-only" }, /both HERMES_EDGE_CLIENT_ID/],
  ])("refuses %o", (override, reason) => {
    const c = getRuntimeConfig({ ...hermes, ...override });
    expect(c.state).toBe("misconfigured");
    expect(c.reason).toMatch(reason);
  });

  it("allows plain http only to loopback outside production", () => {
    expect(getRuntimeConfig({ ...hermes, NODE_ENV: "development", HERMES_URL: "http://127.0.0.1:8642" }).state).toBe("ready");
    expect(getRuntimeConfig({ ...hermes, NODE_ENV: "development", HERMES_URL: "http://agent.lan:8642" }).state).toBe("misconfigured");
  });

  it("sends edge credentials as Cloudflare Access headers when both are set", () => {
    const c = getRuntimeConfig({ ...hermes, HERMES_EDGE_CLIENT_ID: "cid", HERMES_EDGE_CLIENT_SECRET: "csecret" });
    expect(c.hermes?.edgeHeaders).toEqual({ "CF-Access-Client-Id": "cid", "CF-Access-Client-Secret": "csecret" });
  });

  it("binds to the configured profile, never one chosen by a caller", () => {
    expect(getRuntimeConfig({ ...hermes, HERMES_PROFILE: "work" }).hermes?.profile).toBe("work");
  });
});

describe("capabilities", () => {
  it("offers approvals, stop and a live check only on Hermes", () => {
    expect(capabilitiesOf("hermes")).toEqual({ approvals: true, stop: true, liveStatus: true, connectionTest: true });
    expect(capabilitiesOf("openrouter")).toEqual({ approvals: false, stop: false, liveStatus: false, connectionTest: false });
    expect(capabilitiesOf(null).approvals).toBe(false);
  });

  it("reports no capabilities while the chosen runtime is not ready", () => {
    expect(publicRuntimeStatus(getRuntimeConfig({ AGENT_RUNTIME: "hermes" })).capabilities.approvals).toBe(false);
  });
});

describe("publicRuntimeStatus", () => {
  it("never contains a key, the URL or edge credentials", () => {
    const env = { ...hermes, HERMES_EDGE_CLIENT_ID: "cid-123", HERMES_EDGE_CLIENT_SECRET: "csecret-456" };
    const text = JSON.stringify(publicRuntimeStatus(getRuntimeConfig(env)));
    expect(text).not.toContain(KEY);
    expect(text).not.toContain("agent.example.com");
    expect(text).not.toContain("csecret-456");
    expect(text).not.toContain("cid-123");
    // Misconfigured reasons name variables, never values.
    const bad = JSON.stringify(publicRuntimeStatus(getRuntimeConfig({ ...hermes, HERMES_API_KEY: "tooshort" })));
    expect(bad).not.toContain("tooshort");
    const openrouter = JSON.stringify(publicRuntimeStatus(getRuntimeConfig({ OPENROUTER_API_KEY: "sk-or-secret-value" })));
    expect(openrouter).not.toContain("sk-or-secret-value");
  });

  it("names the configured agent", () => {
    const status = publicRuntimeStatus(getRuntimeConfig({ ...hermes, AGENT_DISPLAY_NAME: "Robin" }));
    expect(status).toMatchObject({ runtime: "hermes", displayName: "Robin", state: "ready" });
    expect(status.message).toContain("Robin");
  });
});
