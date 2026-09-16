import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { findSimilarNotes, findSimilarToText } from "@/lib/ai/embeddings";

// GET /api/embeddings/similar?noteId=xxx&threshold=0.5&limit=10
// GET /api/embeddings/similar?text=xxx&threshold=0.5&limit=10
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const noteId = searchParams.get("noteId");
  const text = searchParams.get("text");
  const threshold = parseFloat(searchParams.get("threshold") || "0.5");
  const limit = parseInt(searchParams.get("limit") || "10");

  if (!noteId && !text) {
    return NextResponse.json(
      { error: "Either noteId or text is required" },
      { status: 400 }
    );
  }

  try {
    let similar;

    if (noteId) {
      // Find notes similar to a specific note
      similar = await findSimilarNotes(user.id, noteId, threshold, limit);
    } else if (text) {
      // Find notes similar to arbitrary text
      similar = await findSimilarToText(user.id, text, threshold, limit);
    }

    return NextResponse.json({
      similar,
      query: noteId ? { noteId } : { text },
      threshold,
      limit,
    });
  } catch (error) {
    console.error("Similar notes error:", error);
    return NextResponse.json(
      { error: "Failed to find similar notes" },
      { status: 500 }
    );
  }
}
