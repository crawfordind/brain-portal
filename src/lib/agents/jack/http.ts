/**
 * Shared response shaping for the Jack routes. Errors leave as a fixed
 * message and status; nothing upstream (URLs, keys, raw bodies) is echoed.
 */

import { NextRequest, NextResponse } from "next/server";
import { JackActionError } from "./dispatcher";
import { checkJackRateLimit, type JackAction } from "./guard";

export const MAX_BODY_BYTES = 64 * 1024;

export async function readJsonBody(
  request: NextRequest,
  maxBytes: number = MAX_BODY_BYTES
): Promise<Record<string, unknown> | NextResponse> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxBytes) {
    return NextResponse.json({ error: "Request body too large" }, { status: 413 });
  }
  let text: string;
  try {
    text = await request.text();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (text.length > maxBytes) {
    return NextResponse.json({ error: "Request body too large" }, { status: 413 });
  }
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    return parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
}

export function rateLimited(userId: string, action: JackAction): NextResponse | null {
  const { allowed, retryAfterSeconds } = checkJackRateLimit(userId, action);
  if (allowed) return null;
  return NextResponse.json(
    { error: "Too many requests. Try again shortly." },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
  );
}

export function actionErrorResponse(error: unknown, context: string): NextResponse {
  if (error instanceof JackActionError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error(`[Jack] ${context} failed:`, error instanceof Error ? error.message : error);
  return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
}
