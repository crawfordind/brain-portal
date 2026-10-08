import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getPortfolio } from "@/lib/operations/portfolio";
import { opsErrorResponse } from "../errors";

// GET /api/operations/portfolio - Projects grouped into lanes (ventures), each
// with its lane state, health, next move and next date.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await getPortfolio(user.id));
  } catch (error) {
    return opsErrorResponse(error, "GET /api/operations/portfolio");
  }
}
