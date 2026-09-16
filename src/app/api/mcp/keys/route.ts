/**
 * GET  /api/mcp/keys  — list the current user's MCP API keys (no secrets).
 * POST /api/mcp/keys  — create a new key. Returns the plaintext key ONCE.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  createKeyForUser,
  listKeysForUser,
  validateScopes,
  MCP_SCOPES,
  type McpScope,
} from "@/lib/mcp/keys";
import { ensureMcpKeysTable } from "@/lib/mcp/schema";

export const runtime = "nodejs";

function serverError(err: unknown, action: string) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[mcp/keys] ${action} failed:`, err);
  return NextResponse.json(
    {
      error: "server_error",
      message: `${action} failed: ${message}`,
    },
    { status: 500 }
  );
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await ensureMcpKeysTable();
    const keys = await listKeysForUser(user.id);
    return NextResponse.json({ keys, available_scopes: MCP_SCOPES });
  } catch (err) {
    return serverError(err, "List MCP keys");
  }
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    name,
    scopes,
    rate_limit_per_minute,
    expires_in_days,
  } = (body as {
    name?: unknown;
    scopes?: unknown;
    rate_limit_per_minute?: unknown;
    expires_in_days?: unknown;
  }) ?? {};

  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json(
      { error: "Key name is required" },
      { status: 400 }
    );
  }

  let parsedScopes: McpScope[] = ["*"];
  if (scopes !== undefined) {
    const validated = validateScopes(scopes);
    if (!validated) {
      return NextResponse.json(
        {
          error: "Invalid scopes",
          message: `Scopes must be a non-empty array of: ${[...MCP_SCOPES, "*"].join(", ")}`,
        },
        { status: 400 }
      );
    }
    parsedScopes = validated;
  }

  let rateLimit: number | undefined;
  if (rate_limit_per_minute !== undefined) {
    if (
      typeof rate_limit_per_minute !== "number" ||
      !Number.isFinite(rate_limit_per_minute) ||
      rate_limit_per_minute < 1 ||
      rate_limit_per_minute > 10_000
    ) {
      return NextResponse.json(
        { error: "rate_limit_per_minute must be an integer between 1 and 10000" },
        { status: 400 }
      );
    }
    rateLimit = Math.floor(rate_limit_per_minute);
  }

  let expiresInDays: number | undefined;
  if (expires_in_days !== undefined && expires_in_days !== null) {
    if (
      typeof expires_in_days !== "number" ||
      !Number.isFinite(expires_in_days) ||
      expires_in_days < 1 ||
      expires_in_days > 365 * 5
    ) {
      return NextResponse.json(
        { error: "expires_in_days must be an integer between 1 and 1825" },
        { status: 400 }
      );
    }
    expiresInDays = Math.floor(expires_in_days);
  }

  try {
    await ensureMcpKeysTable();
    const { key, summary } = await createKeyForUser(user.id, {
      name: name.trim(),
      scopes: parsedScopes,
      rateLimitPerMinute: rateLimit,
      expiresInDays,
    });
    // Plaintext `key` is only returned here, once. Summary has no secrets.
    return NextResponse.json({ key, summary }, { status: 201 });
  } catch (err) {
    return serverError(err, "Create MCP key");
  }
}
