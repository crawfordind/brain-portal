/**
 * The account's AI usage: running token totals per model, and the recent
 * calls with the prompt each one sent.
 *
 * GET    /api/ai-usage?limit=50   totals + recent calls
 * DELETE /api/ai-usage            clear both and start counting again
 *
 * Session-only: the prompts are the person's own notes.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getAiUsageReport, resetAiUsage } from "@/lib/ai/usage/store";
import { isMissingAiUsageTable } from "@/lib/ai/usage/schema";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const limit = Number(request.nextUrl.searchParams.get("limit")) || 50;
  try {
    return NextResponse.json(await getAiUsageReport(user.id, { limit }), { headers: NO_STORE });
  } catch (error) {
    console.error("[API] GET /api/ai-usage failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Couldn't load AI usage" }, { status: 500 });
  }
}

export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await resetAiUsage(user.id);
  } catch (error) {
    if (!isMissingAiUsageTable(error)) {
      console.error("[API] DELETE /api/ai-usage failed:", error instanceof Error ? error.message : error);
      return NextResponse.json({ error: "Couldn't reset AI usage" }, { status: 500 });
    }
  }
  return NextResponse.json(await getAiUsageReport(user.id), { headers: NO_STORE });
}
