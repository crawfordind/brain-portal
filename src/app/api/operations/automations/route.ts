import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getAutomationHealth } from "@/lib/operations/automations";
import { opsErrorResponse } from "../errors";

// GET /api/operations/automations - Every background job, its last known
// outcome, and a plain-language reason when it is not healthy.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({
      automations: await getAutomationHealth(user.id),
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    return opsErrorResponse(error, "GET /api/operations/automations");
  }
}
