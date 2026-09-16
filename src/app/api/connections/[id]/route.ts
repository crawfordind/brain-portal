import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";

// DELETE /api/connections/[id] - Remove a connection
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id: connectionId } = await params;

    // Verify connection belongs to user before deleting
    const result = await db.execute({
      sql: "DELETE FROM note_connections WHERE id = ? AND user_id = ?",
      args: [connectionId, user.id]
    });

    if (result.rowsAffected === 0) {
      return NextResponse.json(
        { error: "Connection not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete connection:", error);
    return NextResponse.json(
      { error: "Failed to delete connection" },
      { status: 500 }
    );
  }
}
