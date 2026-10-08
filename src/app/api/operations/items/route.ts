import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { safeParseJson, isErrorResponse, isValidPriority } from "@/lib/api/validation";
import { validateOpsPatch } from "@/lib/operations/fields";
import { FOLLOW_THROUGH_VIEWS, filterView, type FollowThroughView } from "@/lib/operations/classify";
import { createOpsItem, getToday, loadOpenItems } from "@/lib/operations/queries";
import { opsErrorResponse } from "../errors";

// GET /api/operations/items?view=decisions|waiting|commitments|blocked
// The full list behind a home-screen section.
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const view = request.nextUrl.searchParams.get("view") ?? "decisions";
  if (!(FOLLOW_THROUGH_VIEWS as readonly string[]).includes(view)) {
    return NextResponse.json(
      { error: `view must be one of ${FOLLOW_THROUGH_VIEWS.join(", ")}` },
      { status: 400 }
    );
  }

  try {
    const [{ today }, items] = await Promise.all([getToday(user.id), loadOpenItems(user.id)]);
    const counts = Object.fromEntries(
      FOLLOW_THROUGH_VIEWS.map((v) => [v, filterView(items, v).length])
    );
    return NextResponse.json({
      today,
      view,
      items: filterView(items, view as FollowThroughView),
      counts,
    });
  } catch (error) {
    return opsErrorResponse(error, "GET /api/operations/items");
  }
}

// POST /api/operations/items - Create a task that carries operational state
// (a decision, something waited on, a promise). It is an ordinary task row.
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await safeParseJson(request);
  if (isErrorResponse(body)) return body;

  if (typeof body.title !== "string" || !body.title.trim()) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  if (body.priority !== undefined && !isValidPriority(body.priority)) {
    return NextResponse.json({ error: "Invalid priority" }, { status: 400 });
  }
  const patch = validateOpsPatch(body.ops ?? {});
  if (!patch.ok) return NextResponse.json({ error: patch.error }, { status: 400 });

  try {
    const item = await createOpsItem(user.id, {
      title: body.title,
      description: typeof body.description === "string" ? body.description : undefined,
      projectId: typeof body.projectId === "string" ? body.projectId : null,
      dueDate: typeof body.dueDate === "string" ? body.dueDate : null,
      priority: body.priority as "low" | "medium" | "high" | "urgent" | undefined,
      ops: patch.patch,
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    return opsErrorResponse(error, "POST /api/operations/items");
  }
}
