import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getOperationsOverview } from "@/lib/operations/queries";
import { alertsOnly, getAutomationHealth } from "@/lib/operations/automations";
import { opsErrorResponse } from "./errors";

// GET /api/operations - The Operations home: bounded sections, counts, and
// only the automations that need a human.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const [overview, automations] = await Promise.all([
      getOperationsOverview(user.id),
      getAutomationHealth(user.id),
    ]);
    return NextResponse.json({ ...overview, automationAlerts: alertsOnly(automations) });
  } catch (error) {
    return opsErrorResponse(error, "GET /api/operations");
  }
}
