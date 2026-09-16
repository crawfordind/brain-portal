import { NextRequest, NextResponse } from "next/server";
import { db, mutate, queryAll, queryOne } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";
import { Capture } from "@/lib/db/schema";
import { isPublicUrl } from "@/lib/utils/url";
import { enqueue } from "@/lib/processing/queue";
import { safeParseJson, isErrorResponse, isValidCaptureType } from "@/lib/api/validation";

// GET /api/captures - List all captures
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const searchParams = request.nextUrl.searchParams;
    const type = searchParams.get("type");
    const processed = searchParams.get("processed");
    const limit = Math.min(Math.max(1, parseInt(searchParams.get("limit") || "50")), 200);

    let query = `
      SELECT
        c.*,
        dn.date as daily_note_date
      FROM captures c
      LEFT JOIN daily_notes dn ON c.daily_note_id = dn.id
      WHERE c.user_id = ?
    `;
    const args: (string | number)[] = [user.id];

    if (type) {
      query += " AND c.capture_type = ?";
      args.push(type);
    }

    if (processed === "true") {
      query += " AND c.processed = 1";
    } else if (processed === "false") {
      query += " AND c.processed = 0";
    }

    query += " ORDER BY c.captured_at DESC LIMIT ?";
    args.push(limit);

    const captures = await queryAll<Capture & { daily_note_date?: string }>(query, args);

    return NextResponse.json({ captures });
  } catch (error) {
    console.error("[API] GET /api/captures failed:", error);
    return NextResponse.json({ error: "Failed to fetch captures" }, { status: 500 });
  }
}

// POST /api/captures - Create a new capture
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await safeParseJson(request);
  if (isErrorResponse(body)) return body;
  const content = body.content as string | undefined;
  const captureType = (body.captureType as string) || "thought";
  const dailyNoteId = body.dailyNoteId as string | undefined;
  const tags = body.tags as string[] | undefined;
  const metadata = body.metadata as Record<string, unknown> | undefined;

  if (!content || typeof content !== "string" || !content.trim()) {
    return NextResponse.json({ error: "Content is required" }, { status: 400 });
  }

  if (captureType !== "thought" && !isValidCaptureType(captureType)) {
    return NextResponse.json({ error: "Invalid capture type" }, { status: 400 });
  }

  // For link captures, validate metadata. This URL gets enqueued for
  // server-side scraping, so reject a private target at the door rather than
  // letting the job fail later with nothing to show the user.
  if (captureType === "link" && metadata?.url) {
    if (!isPublicUrl(metadata.url as string)) {
      return NextResponse.json(
        { error: "Invalid URL: must be a public http or https address" },
        { status: 400 }
      );
    }
  }

  // Prepare metadata JSON
  const metadataJson = metadata ? JSON.stringify(metadata) : "{}";

  // Create capture — use RETURNING to avoid the race of SELECT ORDER BY created_at
  const capture = await mutate<Capture>(
    `INSERT INTO captures (user_id, content, capture_type, daily_note_id, tags, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
      RETURNING *`,
    [
      user.id,
      content.trim(),
      captureType,
      dailyNoteId || null,
      tags ? JSON.stringify(tags) : "[]",
      metadataJson,
    ]
  );

  if (!capture) {
    return NextResponse.json(
      { error: "Failed to create capture" },
      { status: 500 }
    );
  }

  // If link with scraping enabled, queue job
  if (captureType === "link" && metadata?.scrapeEnabled && metadata?.url) {
    try {
      await enqueue({
        userId: user.id,
        entityType: "capture",
        entityId: capture.id,
        operation: "link-scrape-and-embed",
        tier: "embedding",
        priority: 5,
        metadata: {
          captureId: capture.id,
          url: metadata.url,
          userId: user.id,
        },
      });
    } catch (queueError) {
      // Log but don't fail the request if queueing fails
      console.error("Failed to queue link scraping job:", queueError);
    }
  }

  return NextResponse.json({ capture }, { status: 201 });
}
