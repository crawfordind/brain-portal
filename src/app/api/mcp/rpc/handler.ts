/**
 * Shared request handler for the HTTP MCP transport.
 *
 * Lives apart from the route files so the same logic backs both
 * `/api/mcp/rpc` (key in the Authorization header) and
 * `/api/mcp/rpc/<key>` (key in the URL path).
 *
 * The path-key form exists because some MCP clients — notably the
 * Claude.ai custom-connector UI, which only offers OAuth client
 * id/secret fields — cannot attach a static bearer header. Embedding
 * the key in the URL lets those clients connect as an "authless"
 * connector while the server still authenticates every request.
 */

import { NextRequest } from "next/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { validateApiKey, type AuthenticatedUser } from "@/mcp/auth";
import { createToolContext } from "@/mcp/guard";
import { registerAllTools } from "@/mcp/tools/index";
import { registerResources } from "@/mcp/resources/index";
import { registerPrompts } from "@/mcp/prompts/index";

/** Every issued key carries this prefix (see `generateApiKey`). */
const KEY_PREFIX = "bp_mcp_";

function jsonError(status: number, error: string, message?: string): Response {
  return new Response(
    JSON.stringify({ error, ...(message ? { message } : {}) }),
    {
      status,
      headers: {
        "content-type": "application/json",
        // Keys can ride in the URL — never let a proxy cache the response.
        "cache-control": "no-store",
      },
    }
  );
}

/**
 * Pull the API key off a request, in order of preference:
 *   1. `Authorization: Bearer <key>` header
 *   2. URL path segment (`/api/mcp/rpc/<key>`)
 *   3. `?key=<key>` query parameter
 *
 * The URL-borne forms must look like a Brain Portal key so unrelated
 * sub-paths aren't mistaken for credentials.
 */
export function extractApiKey(
  request: Request,
  pathKey?: string
): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (match) return match[1];

  if (pathKey?.startsWith(KEY_PREFIX)) return pathKey;

  try {
    const queryKey = new URL(request.url).searchParams.get("key");
    if (queryKey?.startsWith(KEY_PREFIX)) return queryKey;
  } catch {
    // Malformed URL — fall through to the unauthorized path.
  }

  return null;
}

async function authenticate(
  request: NextRequest,
  pathKey?: string
): Promise<AuthenticatedUser | Response> {
  const key = extractApiKey(request, pathKey);
  if (!key) {
    return jsonError(
      401,
      "unauthorized",
      "Missing credentials. Send `Authorization: Bearer <key>`, or put the " +
        "key in the URL as /api/mcp/rpc/<key> for clients that cannot set headers."
    );
  }

  const user = await validateApiKey(key);
  if (!user) {
    return jsonError(401, "unauthorized", "Invalid, revoked, or expired API key.");
  }
  return user;
}

export async function handleMcpRequest(
  request: NextRequest,
  pathKey?: string
): Promise<Response> {
  const auth = await authenticate(request, pathKey);
  if (auth instanceof Response) return auth;
  const user: AuthenticatedUser = auth;

  // Fresh MCP server per request — stateless, no session coupling.
  const server = new McpServer({
    name: "brain-portal",
    version: "1.0.0",
  });

  // A client that groups its own job passes this; without it the server
  // infers the grouping from the key's write cadence. Either way, rows
  // written by one job share a run id and the stream renders them as one row
  // rather than as N unrelated-looking entries.
  const runId = request.headers.get("x-brain-run-id");

  const ctx = createToolContext(() => user, { runId });

  // All three, and in this order, must match src/mcp/server.ts. The HTTP
  // transport is the one remote agents use; dropping resources or prompts here
  // makes them silently unavailable over HTTP while stdio still works.
  registerAllTools(server, ctx);
  registerResources(server, ctx);
  registerPrompts(server, ctx);

  const transport = new WebStandardStreamableHTTPServerTransport({
    // Stateless mode: no session tracking across requests.
    sessionIdGenerator: undefined,
    // Return plain JSON instead of SSE — simpler for non-streaming
    // clients. Streaming clients can still initiate SSE via GET.
    enableJsonResponse: true,
  });

  await server.connect(transport);

  try {
    return await transport.handleRequest(request);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonError(500, "internal_error", message);
  }
}
