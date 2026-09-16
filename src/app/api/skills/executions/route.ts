import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getSkillExecutions, initializeSkills } from "@/lib/skills";

// GET /api/skills/executions - Get skill execution history
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  initializeSkills();

  const searchParams = request.nextUrl.searchParams;
  const skillId = searchParams.get("skill_id") || undefined;
  const status = searchParams.get("status") || undefined;
  const limit = parseInt(searchParams.get("limit") || "50", 10);

  const executions = await getSkillExecutions(user.id, {
    skillId,
    status,
    limit: Math.min(limit, 100),
  });

  return NextResponse.json({
    executions,
    total: executions.length,
  });
}
