import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { forceEvolve } from "@/lib/guardrails/evolution";

// POST /api/guardrails/evolve — force an evolution cycle
export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const learnedContext = await forceEvolve(user.id);

    return NextResponse.json({
      learned_context: learnedContext,
      message: "Evolution cycle complete",
    });
  } catch (error) {
    return NextResponse.json({ error: "Evolution cycle failed" }, { status: 500 });
  }
}
