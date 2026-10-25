/**
 * Shared plumbing for the whiteboard API routes.
 */

import { NextResponse } from "next/server";
import { WhiteboardError } from "./store";
import { isMissingWhiteboardTables } from "./schema";

/** Map a whiteboard failure onto a response without leaking internals. */
export function whiteboardErrorResponse(error: unknown, fallback: string): NextResponse {
  if (error instanceof WhiteboardError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (isMissingWhiteboardTables(error)) {
    return NextResponse.json(
      { error: "Whiteboards aren't set up on this server yet. Run `npm run db:migrate`.", code: "NOT_MIGRATED" },
      { status: 503 }
    );
  }
  console.error(`[WHITEBOARDS] ${fallback}:`, error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

/** Whiteboard writes are small and frequent; anything larger is not a canvas. */
export const MAX_BODY_BYTES = 1024 * 1024;

export async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_BODY_BYTES) return null;
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return null;
  try {
    const parsed = JSON.parse(text || "{}");
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}
