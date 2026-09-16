import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { executeSkill, initializeSkills } from "@/lib/skills";

// POST /api/skills/execute - Execute a skill
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    initializeSkills();

    const body = await request.json();
    const { skill_id, params = {} } = body;

    if (!skill_id) {
      return NextResponse.json(
        { error: "skill_id is required" },
        { status: 400 }
      );
    }

    const result = await executeSkill({
      skillId: skill_id,
      userId: user.id,
      params,
      triggerSource: "api",
    });

    if (!result.success) {
      return NextResponse.json(
        {
          error: result.error,
          execution_id: result.executionId,
          duration_ms: result.durationMs,
        },
        { status: 422 }
      );
    }

    return NextResponse.json({
      success: true,
      execution_id: result.executionId,
      output: result.output,
      duration_ms: result.durationMs,
    });
  } catch (error) {
    return NextResponse.json({ error: "Skill execution failed" }, { status: 500 });
  }
}
