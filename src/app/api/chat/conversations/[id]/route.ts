import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { queryAll, queryOne, mutate } from "@/lib/db/client";
import { ChatConversation, ChatMessage } from "@/lib/db/schema";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const conversation = await queryOne<ChatConversation>(
    "SELECT * FROM chat_conversations WHERE id = ? AND user_id = ?",
    [id, user.id]
  );

  if (!conversation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const messages = await queryAll<ChatMessage>(
    "SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC",
    [id]
  );

  return NextResponse.json({ conversation, messages });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const conversation = await queryOne<ChatConversation>(
    "SELECT id FROM chat_conversations WHERE id = ? AND user_id = ?",
    [id, user.id]
  );

  if (!conversation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await mutate("DELETE FROM chat_conversations WHERE id = ?", [id]);

  return NextResponse.json({ success: true });
}
