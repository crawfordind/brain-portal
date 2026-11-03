import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { listTemplates, loadSeriesNotes } from "@/lib/templates/store";
import { templateErrorResponse } from "@/lib/templates/http";
import { findSeries } from "@/lib/templates/series";

// GET /api/templates/suggestions?projectId= - recurring notes that would make
// a good template. Rules only; no model is called.
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const projectId = new URL(request.url).searchParams.get("projectId") || null;
  try {
    const { notes } = await loadSeriesNotes(user.id, projectId);
    const templates = await listTemplates(user.id).catch(() => []);
    const series = findSeries(notes, templates).slice(0, 12);
    return NextResponse.json({ suggestions: series, scanned: notes.length });
  } catch (error) {
    return templateErrorResponse(error, "Couldn't look for recurring notes");
  }
}
