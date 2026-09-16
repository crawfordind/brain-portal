/**
 * MCP over HTTP with the API key carried in the URL path.
 *
 *   Endpoint:  POST /api/mcp/rpc/bp_mcp_...
 *
 * Identical to `/api/mcp/rpc` in every respect except where the
 * credential comes from. This exists for MCP clients that only accept a
 * server URL and offer no way to attach a static `Authorization` header
 * — the Claude.ai custom-connector form, for instance, exposes only
 * OAuth client id/secret fields.
 *
 * Trade-off: a key in a URL is more exposure-prone than one in a header
 * (proxy access logs, browser history, referrers). Issue a dedicated,
 * narrowly-scoped, expiring key for this route rather than reusing a
 * wildcard key, and revoke it from Settings → "AI API access" if the URL
 * leaks.
 */

import { NextRequest } from "next/server";
import { handleMcpRequest } from "../handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ key: string }> };

async function handle(
  request: NextRequest,
  { params }: RouteContext
): Promise<Response> {
  const { key } = await params;
  return handleMcpRequest(request, key);
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
