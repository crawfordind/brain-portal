/**
 * Shared plumbing for the template API routes.
 */

import { NextResponse } from "next/server";
import { TemplateError } from "./store";
import { isMissingTemplateTable } from "./schema";

export function templateErrorResponse(error: unknown, fallback: string): NextResponse {
  if (error instanceof TemplateError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (isMissingTemplateTable(error)) {
    return NextResponse.json(
      { error: "Templates aren't set up on this server yet. Run `npm run db:migrate`.", code: "NOT_MIGRATED" },
      { status: 503 }
    );
  }
  console.error(`[TEMPLATES] ${fallback}:`, error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

const MAX_BODY_BYTES = 256 * 1024;

export async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_BODY_BYTES) return null;
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return null;
  try {
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
