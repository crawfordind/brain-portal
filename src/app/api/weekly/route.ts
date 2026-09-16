import { NextRequest, NextResponse } from "next/server";
import { queryAll, queryOne } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";
import { Note, WeeklyReview } from "@/lib/db/schema";

// GET /api/weekly - List weekly reviews
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const year = searchParams.get("year");
  const limit = parseInt(searchParams.get("limit") || "12");

  let query = `
    SELECT
      wr.*,
      n.title as note_title,
      n.slug as note_slug
    FROM weekly_reviews wr
    LEFT JOIN notes n ON wr.note_id = n.id
    WHERE wr.user_id = ?
  `;
  const args: (string | number)[] = [user.id];

  if (year) {
    query += " AND wr.year = ?";
    args.push(parseInt(year));
  }

  query += " ORDER BY wr.year DESC, wr.week_number DESC LIMIT ?";
  args.push(limit);

  const reviews = await queryAll<WeeklyReview & { note_title?: string; note_slug?: string }>(query, args);

  return NextResponse.json({ reviews });
}

// GET /api/weekly/[id] - Get a specific weekly review
export async function OPTIONS(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "ID is required" }, { status: 400 });
  }

  const review = await queryOne<WeeklyReview>(
    "SELECT * FROM weekly_reviews WHERE id = ? AND user_id = ?",
    [id, user.id]
  );

  if (!review) {
    return NextResponse.json({ error: "Review not found" }, { status: 404 });
  }

  // Get associated note
  let note: Note | null = null;
  if (review.note_id) {
    note = await queryOne<Note>(
      "SELECT * FROM notes WHERE id = ?",
      [review.note_id]
    );
  }

  return NextResponse.json({ review, note });
}
