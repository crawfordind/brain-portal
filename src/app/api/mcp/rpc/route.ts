/**
 * MCP over HTTP (Streamable HTTP transport).
 *
 * Exposes the same tools / resources / prompts that `src/mcp/server.ts`
 * serves over stdio, but over Web-Standard HTTP so remote agents can
 * connect without running a local subprocess.
 *
 *   Endpoint:  POST /api/mcp/rpc      (JSON-RPC, also handles GET/DELETE
 *                                      per the Streamable HTTP spec)
 *   Auth:      Authorization: Bearer bp_mcp_...
 *
 * Clients that cannot set request headers can instead use
 * `/api/mcp/rpc/<key>` — see `[key]/route.ts`.
 *
 * The request handling itself lives in `handler.ts`, shared with the
 * path-key route.
 */

import { NextRequest } from "next/server";
import { handleMcpRequest } from "./handler";

// Node runtime required: the MCP tool handlers use libsql and OpenAI
// clients, which don't run on Edge.
export const runtime = "nodejs";
// Don't try to cache JSON-RPC calls.
export const dynamic = "force-dynamic";

function handle(request: NextRequest): Promise<Response> {
  return handleMcpRequest(request);
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
