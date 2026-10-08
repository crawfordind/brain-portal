import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { listIntake } from "@/lib/operations/intake";
import { opsErrorResponse } from "../errors";

// GET /api/operations/intake - Untriaged captures, each with a rule-based
// proposal. Proposals are computed, never stored.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await listIntake(user.id));
  } catch (error) {
    return opsErrorResponse(error, "GET /api/operations/intake");
  }
}
