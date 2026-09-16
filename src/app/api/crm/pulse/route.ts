/**
 * GET /api/crm/pulse — the dashboard's CRM summary.
 *
 * The same shape the home page renders server-side, exposed for the navigation
 * badges, which are client components and cannot call `getCrmPulse` directly.
 * `getCrmPulse` never throws, so this route has no failure mode beyond auth.
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getCrmPulse } from "@/lib/crm/pulse";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(await getCrmPulse(user.id));
}
