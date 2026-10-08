import { describe, it, expect } from "vitest";
import { getJackConfig, publicJackStatus } from "@/lib/agents/jack/config";

const KEY = "k".repeat(32);
const good = {
  JACK_ENABLED: "true",
  JACK_HERMES_URL: "https://jack.example.com/p/jack/",
  JACK_HERMES_API_KEY: KEY,
  NODE_ENV: "production",
};

describe("getJackConfig", () => {
  it("is disabled by default, with an honest reason", () => {
    const c = getJackConfig({});
    expect(c.state).toBe("disabled");
    expect(c.reason).toMatch(/Jack connection not configured/);
    expect(c.apiKey).toBe("");
  });

  it("stays disabled unless JACK_ENABLED is exactly true, even with a URL and key", () => {
    expect(getJackConfig({ ...good, JACK_ENABLED: "1" }).state).toBe("disabled");
    expect(getJackConfig({ ...good, JACK_ENABLED: undefined }).state).toBe("disabled");
  });

  it("is ready with an https URL and a strong key; trims the trailing slash", () => {
    const c = getJackConfig(good);
    expect(c.state).toBe("ready");
    expect(c.baseUrl).toBe("https://jack.example.com/p/jack");
    expect(c.profile).toBe("jack");
  });

  it.each([
    [{ JACK_HERMES_URL: "" }, /JACK_HERMES_URL is not set/],
    [{ JACK_HERMES_URL: "not a url" }, /not a valid URL/],
    [{ JACK_HERMES_URL: "http://jack.example.com" }, /must use https/],
    [{ JACK_HERMES_URL: "http://127.0.0.1:8642" }, /must use https/],
    [{ JACK_HERMES_URL: "https://user:pass@jack.example.com" }, /must not contain credentials/],
    [{ JACK_HERMES_URL: "https://jack.example.com/?key=x" }, /query string/],
    [{ JACK_HERMES_API_KEY: "" }, /JACK_HERMES_API_KEY is not set/],
    [{ JACK_HERMES_API_KEY: "short" }, /shorter than 16/],
    [{ JACK_EDGE_CLIENT_ID: "id-only" }, /both JACK_EDGE_CLIENT_ID/],
  ])("refuses %o", (override, reason) => {
    const c = getJackConfig({ ...good, ...override });
    expect(c.state).toBe("misconfigured");
    expect(c.reason).toMatch(reason);
  });

  it("allows plain http only to loopback outside production", () => {
    expect(getJackConfig({ ...good, NODE_ENV: "development", JACK_HERMES_URL: "http://127.0.0.1:8642" }).state).toBe("ready");
    expect(getJackConfig({ ...good, NODE_ENV: "development", JACK_HERMES_URL: "http://jack.lan:8642" }).state).toBe("misconfigured");
  });

  it("sends edge credentials as Cloudflare Access headers when both are set", () => {
    const c = getJackConfig({ ...good, JACK_EDGE_CLIENT_ID: "cid", JACK_EDGE_CLIENT_SECRET: "csecret" });
    expect(c.edgeHeaders).toEqual({ "CF-Access-Client-Id": "cid", "CF-Access-Client-Secret": "csecret" });
  });

  it("binds to the configured profile, never one chosen by a caller", () => {
    expect(getJackConfig({ ...good, JACK_PROFILE: "jack-work" }).profile).toBe("jack-work");
  });
});

describe("publicJackStatus", () => {
  it("never contains the key, the URL or edge credentials", () => {
    const env = { ...good, JACK_EDGE_CLIENT_ID: "cid-123", JACK_EDGE_CLIENT_SECRET: "csecret-456" };
    const text = JSON.stringify(publicJackStatus(getJackConfig(env)));
    expect(text).not.toContain(KEY);
    expect(text).not.toContain("jack.example.com");
    expect(text).not.toContain("csecret-456");
    expect(text).not.toContain("cid-123");
    // Misconfigured reasons name variables, never values.
    const bad = JSON.stringify(publicJackStatus(getJackConfig({ ...good, JACK_HERMES_API_KEY: "tooshort" })));
    expect(bad).not.toContain("tooshort");
  });
});
