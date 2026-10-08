/**
 * One error translation for every Operations route: an `OpsError` carries its
 * own status and a message safe to show; anything else is logged and reported
 * as a plain 500 without leaking internals.
 */

import { NextResponse } from "next/server";
import { OpsError } from "@/lib/operations/queries";

export function opsErrorResponse(error: unknown, route: string): NextResponse {
  if (error instanceof OpsError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error(`[API] ${route} failed:`, error);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}
