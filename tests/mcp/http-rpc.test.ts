/**
 * Integration-style tests for the HTTP MCP endpoint
 * (/api/mcp/rpc). These focus on the auth layer — the full JSON-RPC
 * protocol is exercised by the MCP SDK itself and isn't re-tested here.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the MCP standalone DB (used by auth + tool handlers).
vi.mock("@/mcp/db", () => {
  const queryOne = vi.fn();
  const query = vi.fn();
  const db = { execute: vi.fn() };
  return { db, query, queryOne, mutate: vi.fn() };
});

// Mock the MCP SDK so we don't actually spin up a server / transport.
const mockHandleRequest = vi.fn(
  async () => new Response(JSON.stringify({ ok: true }), { status: 200 })
);
const mockConnect = vi.fn(async () => undefined);

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: class {
    tool = vi.fn();
    resource = vi.fn();
    prompt = vi.fn();
    connect = mockConnect;
  },
  ResourceTemplate: class {
    constructor(public template: string) {}
  },
}));

vi.mock("@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js", () => ({
  WebStandardStreamableHTTPServerTransport: class {
    handleRequest = mockHandleRequest;
  },
}));

import { queryOne } from "@/mcp/db";
import { createHash } from "crypto";

const mockQueryOne = vi.mocked(queryOne);

async function loadRoute() {
  return await import("@/app/api/mcp/rpc/route");
}

async function loadKeyRoute() {
  return await import("@/app/api/mcp/rpc/[key]/route");
}

function jsonRpcRequest(
  body: unknown,
  headers: Record<string, string> = {},
  url = "https://example.com/api/mcp/rpc"
) {
  const req = new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  // Next.js' NextRequest-shaped wrapper — the route only uses `.headers`
  // and passes the raw request through to the SDK, so a plain Request is
  // sufficient for auth tests.
  return req as unknown as import("next/server").NextRequest;
}

/**
 * Make the next `validateApiKey` lookup resolve to an active wildcard key.
 * (validateApiKey does a SELECT, then an UPDATE on last_used_at.)
 */
function mockValidKey(rawKey: string) {
  mockQueryOne.mockResolvedValueOnce({
    id: "k1",
    user_id: "u1",
    name: "HTTP key",
    key_hash: createHash("sha256").update(rawKey).digest("hex"),
    key_prefix: rawKey.substring(0, 12),
    scopes: '["*"]',
    is_active: 1,
    rate_limit_per_minute: 60,
    last_used_at: null,
    expires_at: null,
    created_at: "2026-01-01",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("/api/mcp/rpc authentication", () => {
  it("rejects requests without an Authorization header", async () => {
    const { POST } = await loadRoute();
    const res = await POST(jsonRpcRequest({ jsonrpc: "2.0" }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("unauthorized");
    expect(body.message).toMatch(/Bearer/);
  });

  it("rejects malformed Authorization headers", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      jsonRpcRequest({ jsonrpc: "2.0" }, { authorization: "Basic abc123" })
    );
    expect(res.status).toBe(401);
  });

  it("rejects unknown / revoked / expired keys", async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    const { POST } = await loadRoute();
    const res = await POST(
      jsonRpcRequest(
        { jsonrpc: "2.0" },
        { authorization: "Bearer bp_mcp_nope" }
      )
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.message).toMatch(/Invalid/);
  });

  it("passes the request to the MCP transport for valid keys", async () => {
    const rawKey = "bp_mcp_validkey";
    mockValidKey(rawKey);

    const { POST } = await loadRoute();
    const res = await POST(
      jsonRpcRequest(
        { jsonrpc: "2.0", method: "tools/list", id: 1 },
        { authorization: `Bearer ${rawKey}` }
      )
    );

    expect(res.status).toBe(200);
    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(mockHandleRequest).toHaveBeenCalledTimes(1);
  });

  it("accepts a key from the ?key= query parameter", async () => {
    const rawKey = "bp_mcp_querykey";
    mockValidKey(rawKey);

    const { POST } = await loadRoute();
    const res = await POST(
      jsonRpcRequest(
        { jsonrpc: "2.0", method: "tools/list", id: 1 },
        {},
        `https://example.com/api/mcp/rpc?key=${rawKey}`
      )
    );

    expect(res.status).toBe(200);
    expect(mockHandleRequest).toHaveBeenCalledTimes(1);
  });

  it("ignores a query key that isn't shaped like a Brain Portal key", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      jsonRpcRequest(
        { jsonrpc: "2.0" },
        {},
        "https://example.com/api/mcp/rpc?key=not-a-key"
      )
    );

    expect(res.status).toBe(401);
    expect(mockQueryOne).not.toHaveBeenCalled();
  });
});

describe("/api/mcp/rpc/[key] path authentication", () => {
  const pathContext = (key: string) => ({ params: Promise.resolve({ key }) });

  it("authenticates with the key in the URL path", async () => {
    const rawKey = "bp_mcp_pathkey";
    mockValidKey(rawKey);

    const { POST } = await loadKeyRoute();
    const res = await POST(
      jsonRpcRequest(
        { jsonrpc: "2.0", method: "tools/list", id: 1 },
        {},
        `https://example.com/api/mcp/rpc/${rawKey}`
      ),
      pathContext(rawKey)
    );

    expect(res.status).toBe(200);
    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(mockHandleRequest).toHaveBeenCalledTimes(1);
  });

  it("rejects a path segment that isn't shaped like a key without hitting the DB", async () => {
    const { POST } = await loadKeyRoute();
    const res = await POST(
      jsonRpcRequest(
        { jsonrpc: "2.0" },
        {},
        "https://example.com/api/mcp/rpc/favicon.ico"
      ),
      pathContext("favicon.ico")
    );

    expect(res.status).toBe(401);
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it("rejects an unknown key in the path", async () => {
    mockQueryOne.mockResolvedValueOnce(null);

    const { POST } = await loadKeyRoute();
    const res = await POST(
      jsonRpcRequest(
        { jsonrpc: "2.0" },
        {},
        "https://example.com/api/mcp/rpc/bp_mcp_revoked"
      ),
      pathContext("bp_mcp_revoked")
    );

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.message).toMatch(/Invalid/);
  });

  it("prefers the Authorization header over the path segment", async () => {
    const headerKey = "bp_mcp_headerwins";
    mockValidKey(headerKey);

    const { POST } = await loadKeyRoute();
    const res = await POST(
      jsonRpcRequest(
        { jsonrpc: "2.0", method: "tools/list", id: 1 },
        { authorization: `Bearer ${headerKey}` },
        "https://example.com/api/mcp/rpc/bp_mcp_stalepathkey"
      ),
      pathContext("bp_mcp_stalepathkey")
    );

    expect(res.status).toBe(200);
    const lookupHash = mockQueryOne.mock.calls[0][1]?.[0];
    expect(lookupHash).toBe(
      createHash("sha256").update(headerKey).digest("hex")
    );
  });
});
