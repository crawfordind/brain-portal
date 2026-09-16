import { NextRequest, NextResponse } from "next/server";
import { queryAll } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";
import { AgentConfig } from "@/lib/db/schema";

// GET /api/agents - List all active agents
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const agents = await queryAll<Omit<AgentConfig, "system_prompt">>(
    "SELECT id, agent_type, display_name, description, model_id, icon, is_active, created_at, updated_at FROM agent_configs WHERE is_active = TRUE ORDER BY agent_type"
  );

  return NextResponse.json({ agents });
}
