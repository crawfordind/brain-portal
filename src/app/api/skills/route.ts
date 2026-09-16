import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getSkillDefinitions, initializeSkills } from "@/lib/skills";

// GET /api/skills - List all registered skills
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  initializeSkills();

  const skills = getSkillDefinitions();

  // Optional category filter
  const category = request.nextUrl.searchParams.get("category");
  const filtered = category
    ? skills.filter((s) => s.category === category)
    : skills;

  return NextResponse.json({
    skills: filtered,
    total: filtered.length,
    categories: [...new Set(skills.map((s) => s.category))],
  });
}
