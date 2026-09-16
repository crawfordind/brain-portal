import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";
import { AgentConfig } from "@/lib/db/schema";

// GET /api/agents/[type] - Get specific agent
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ type: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { type } = await params;
  const agent = await queryOne<Omit<AgentConfig, "system_prompt">>(
    "SELECT id, agent_type, display_name, description, model_id, icon, is_active, created_at, updated_at FROM agent_configs WHERE agent_type = ? AND is_active = TRUE",
    [type]
  );

  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  return NextResponse.json({ agent });
}
