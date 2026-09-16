import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// DNS is mocked so the suite is hermetic: these tests are about the decisions
// safeFetch makes given an answer, not about the resolver.
vi.mock("@/lib/utils/dns", () => ({
  resolveHostAddresses: vi.fn(),
}));

import { resolveHostAddresses } from "@/lib/utils/dns";
import { safeFetch, BlockedUrlError } from "@/lib/utils/safe-fetch";

const mockResolve = vi.mocked(resolveHostAddresses);

/** Make every name resolve to a public address unless a test says otherwise. */
function resolvesPublic() {
  mockResolve.mockImplementation(async () => ["93.184.216.34"]);
}

function textResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html" },
  });
}

function redirectTo(location: string, status = 302) {
  return new Response(null, { status, headers: { location } });
}

describe("safeFetch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
    resolvesPublic();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("fetches an ordinary public URL", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(textResponse("<h1>hi</h1>"));

    const result = await safeFetch("https://example.com/a");

    expect(result.status).toBe(200);
    expect(result.body).toBe("<h1>hi</h1>");
    expect(result.finalUrl).toBe("https://example.com/a");
  });

  it("refuses a literal private address without touching the network", async () => {
    await expect(safeFetch("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(
      BlockedUrlError
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("refuses a public NAME that resolves to a private address", async () => {
    // The string check passes; only re-checking the DNS answer catches this.
    mockResolve.mockImplementation(async () => ["169.254.169.254"]);

    await expect(safeFetch("https://totally-innocent.example/")).rejects.toThrow(
      /private address/
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("refuses when ANY resolved address is private, not just the first", async () => {
    mockResolve.mockImplementation(async () => ["93.184.216.34", "10.0.0.7"]);

    await expect(safeFetch("https://split-horizon.example/")).rejects.toThrow(
      BlockedUrlError
    );
  });

  it("re-validates redirect hops instead of following them blindly", async () => {
    // This is the bypass that made isPublicUrl alone insufficient: start
    // somewhere public, get bounced to the metadata service.
    vi.mocked(global.fetch).mockResolvedValueOnce(
      redirectTo("http://169.254.169.254/latest/meta-data/")
    );

    await expect(safeFetch("https://example.com/redirect")).rejects.toThrow(
      BlockedUrlError
    );
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("follows a redirect to another public URL", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(redirectTo("https://example.org/final"))
      .mockResolvedValueOnce(textResponse("done"));

    const result = await safeFetch("https://example.com/start");

    expect(result.body).toBe("done");
    expect(result.finalUrl).toBe("https://example.org/final");
  });

  it("resolves a relative Location against the current URL", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(redirectTo("/elsewhere"))
      .mockResolvedValueOnce(textResponse("landed"));

    const result = await safeFetch("https://example.com/start");

    expect(result.finalUrl).toBe("https://example.com/elsewhere");
    expect(result.body).toBe("landed");
  });

  it("gives up on a redirect loop rather than following it forever", async () => {
    vi.mocked(global.fetch).mockResolvedValue(redirectTo("https://example.com/loop"));

    await expect(safeFetch("https://example.com/loop")).rejects.toThrow(/redirects/);
  });

  it("truncates a body at the byte cap", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(textResponse("x".repeat(5000)));

    const result = await safeFetch("https://example.com/big", { maxBodyBytes: 100 });

    expect(result.body.length).toBeLessThanOrEqual(100);
  });

  it("passes a non-2xx status through rather than throwing", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(textResponse("", 404));

    const result = await safeFetch("https://example.com/missing");

    expect(result.status).toBe(404);
  });

  it("refuses a host that does not resolve at all", async () => {
    mockResolve.mockImplementation(async () => []);

    await expect(safeFetch("https://nope.example/")).rejects.toThrow(BlockedUrlError);
  });
});
