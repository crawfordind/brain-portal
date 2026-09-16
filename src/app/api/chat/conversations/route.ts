import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { queryAll, mutate, queryOne } from "@/lib/db/client";
import { ChatConversation } from "@/lib/db/schema";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const contextType = searchParams.get("contextType");
  const contextId = searchParams.get("contextId");
  const limit = parseInt(searchParams.get("limit") || "20");

  let sql = "SELECT * FROM chat_conversations WHERE user_id = ?";
  const params: (string | number)[] = [user.id];

  if (contextType) {
    sql += " AND context_type = ?";
    params.push(contextType);
  }
  if (contextId) {
    sql += " AND context_id = ?";
    params.push(contextId);
  }

  sql += " ORDER BY updated_at DESC LIMIT ?";
  params.push(limit);

  const conversations = await queryAll<ChatConversation>(sql, params);

  return NextResponse.json({ conversations });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { contextType = "general", contextId, agentType } = body;

  await mutate(
    `INSERT INTO chat_conversations (user_id, agent_type, context_type, context_id)
     VALUES (?, ?, ?, ?)`,
    [user.id, agentType || contextType, contextType, contextId || null]
  );

  const conversation = await queryOne<ChatConversation>(
    "SELECT * FROM chat_conversations WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
    [user.id]
  );

  return NextResponse.json({ conversation }, { status: 201 });
}
