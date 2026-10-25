import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { writeItems } from "@/lib/whiteboards/store";
import { readJsonBody, whiteboardErrorResponse } from "@/lib/whiteboards/http";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/whiteboards/[id]/items - { upserts?: Item[], deletes?: string[] }
// Whole items, client-minted ids, so a retried save never duplicates.
export async function POST(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await readJsonBody(request);
  if (!body) return NextResponse.json({ error: "Invalid or oversized body" }, { status: 400 });

  const { id } = await params;
  try {
    const result = await writeItems(id, user.id, {
      upserts: body.upserts as unknown[] | undefined,
      deletes: body.deletes as unknown[] | undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    return whiteboardErrorResponse(error, "Failed to save the whiteboard");
  }
}
