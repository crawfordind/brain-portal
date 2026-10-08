import { describe, it, expect, vi } from "vitest";
import { createJackClient, JackError } from "@/lib/agents/jack/client";
import type { JackConfig } from "@/lib/agents/jack/config";

const KEY = "hermes-key-0123456789abcdef";
const config: JackConfig = {
  state: "ready",
  reason: null,
  baseUrl: "https://jack.example.com/p/jack",
  apiKey: KEY,
  profile: "jack",
  edgeHeaders: { "CF-Access-Client-Id": "cid", "CF-Access-Client-Secret": "csec" },
};

function respond(status: number, body: unknown, headers: Record<string, string> = {}) {
  return vi.fn().mockResolvedValue(
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...headers },
    })
  );
}

describe("createJackClient", () => {
  it("refuses to exist without a ready configuration", () => {
    expect(() => createJackClient({ ...config, state: "disabled", reason: "off" })).toThrow(JackError);
  });

  it("submits a run with bearer auth, edge headers and the idempotency key, and never follows redirects", async () => {
    const fetchImpl = respond(202, { run_id: "run_abc", status: "started" });
    const client = createJackClient(config, { fetchImpl });
    const result = await client.createRun({ input: "x", instructions: "y", session_id: "s" }, "brain-portal:1:k");

    expect(result).toEqual({ runId: "run_abc", replayed: false });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://jack.example.com/p/jack/v1/runs");
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("error");
    expect(init.headers).toMatchObject({
      Authorization: `Bearer ${KEY}`,
      "Idempotency-Key": "brain-portal:1:k",
      "CF-Access-Client-Id": "cid",
    });
    expect(JSON.parse(init.body)).toEqual({ input: "x", instructions: "y", session_id: "s" });
  });

  it("reports an idempotent replay", async () => {
    const client = createJackClient(config, {
      fetchImpl: respond(202, { run_id: "run_abc" }, { "Idempotency-Replayed": "true" }),
    });
    expect((await client.createRun({ input: "x", instructions: "", session_id: "s" }, "k")).replayed).toBe(true);
  });

  it("polls, stops and resolves approvals at the documented paths", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ status: "running" }), { status: 200 }));
    const client = createJackClient(config, { fetchImpl });
    await client.getRun("run/../x");
    await client.stopRun("run_1");
    await client.resolveApproval("run_1", "deny", "req-1");
    const urls = fetchImpl.mock.calls.map((c) => (c as unknown as [string])[0]);
    expect(urls).toEqual([
      "https://jack.example.com/p/jack/v1/runs/run%2F..%2Fx",
      "https://jack.example.com/p/jack/v1/runs/run_1/stop",
      "https://jack.example.com/p/jack/v1/runs/run_1/approval",
    ]);
    const approvalBody = JSON.parse((fetchImpl.mock.calls[2] as unknown as [string, RequestInit])[1].body as string);
    expect(approvalBody).toEqual({ choice: "deny", request_id: "req-1" });
  });

  it.each([
    [401, "auth", false],
    [403, "auth", false],
    [404, "not_found", false],
    [409, "conflict", false],
    [429, "rate_limited", true],
    [400, "bad_request", false],
    [502, "server", true],
  ])("classifies HTTP %i as %s (retryable: %s)", async (status, kind, retryable) => {
    const client = createJackClient(config, {
      fetchImpl: respond(status, { error: { message: `secret detail ${KEY}`, code: "some_code" } }),
    });
    const error = await client.getRun("run_1").catch((e) => e);
    expect(error).toBeInstanceOf(JackError);
    expect(error.kind).toBe(kind);
    expect(error.retryable).toBe(retryable);
    // Upstream text never becomes the message.
    expect(error.message).not.toContain(KEY);
    expect(error.message).not.toContain("secret detail");
  });

  it("treats network failure and timeout as retryable without leaking the URL", async () => {
    const down = createJackClient(config, { fetchImpl: vi.fn().mockRejectedValue(new TypeError("fetch failed https://jack.example.com")) });
    const e1 = await down.getRun("r").catch((e) => e);
    expect(e1).toMatchObject({ kind: "unreachable", retryable: true });
    expect(e1.message).not.toContain("jack.example.com");

    const timeoutError = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    const slow = createJackClient(config, { fetchImpl: vi.fn().mockRejectedValue(timeoutError), timeoutMs: 4000 });
    expect(await slow.getRun("r").catch((e) => e)).toMatchObject({ kind: "timeout", retryable: true });
  });

  it("rejects a non-JSON success (e.g. a proxy's HTML page) and a run without an id", async () => {
    const html = createJackClient(config, { fetchImpl: respond(200, "<html>login</html>", { "content-type": "text/html" }) });
    expect(await html.getRun("r").catch((e) => e)).toMatchObject({ kind: "bad_response" });
    const noId = createJackClient(config, { fetchImpl: respond(202, { status: "started" }) });
    expect(await noId.createRun({ input: "x", instructions: "", session_id: "s" }, "k").catch((e) => e)).toMatchObject({ kind: "bad_response" });
  });

  it("refuses an oversized response", async () => {
    const big = createJackClient(config, {
      fetchImpl: respond(200, { status: "completed", output: "x".repeat(3 * 1024 * 1024) }),
    });
    expect(await big.getRun("r").catch((e) => e)).toMatchObject({ kind: "bad_response" });
  });
});
