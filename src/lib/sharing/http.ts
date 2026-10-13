/**
 * Shared plumbing for the sharing API routes.
 */

import { NextResponse } from "next/server";
import { ShareError } from "./store";
import { isMissingNoteSharesTable } from "./schema";

/** Map a sharing failure onto a response without leaking internals. */
export function shareErrorResponse(error: unknown, fallback: string): NextResponse {
  if (error instanceof ShareError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (isMissingNoteSharesTable(error)) {
    return NextResponse.json(
      { error: "Sharing with accounts isn't set up on this server yet. Run `npm run db:migrate`." },
      { status: 503 }
    );
  }
  console.error(`[SHARING] ${fallback}:`, error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}
