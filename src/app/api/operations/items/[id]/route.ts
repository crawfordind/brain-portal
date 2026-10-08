import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { safeParseJson, isErrorResponse, isValidTaskStatus } from "@/lib/api/validation";
import { validateOpsPatch } from "@/lib/operations/fields";
import { updateOpsItem } from "@/lib/operations/queries";
import { opsErrorResponse } from "../../errors";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * PATCH /api/operations/items/[id]
 *
 * Body: `{ ops?: {...}, status?, dueDate?, projectId?, title? }`. `ops` keys
 * set to null are cleared. The response carries `previous` (the old `ops`)
 * and `previousStatus`, which is all the client needs for an exact undo.
 *
 * This is deliberately a separate route from `PUT /api/tasks/[id]`: that one
 * has side effects (recurrence spawning, agent delegation) an operational
 * relabel must not trigger.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await safeParseJson(request);
  if (isErrorResponse(body)) return body;

  if (body.status !== undefined && !isValidTaskStatus(body.status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }
  const patch = validateOpsPatch(body.ops ?? {});
  if (!patch.ok) return NextResponse.json({ error: patch.error }, { status: 400 });

  try {
    const result = await updateOpsItem(user.id, id, {
      ops: patch.patch,
      status: body.status as "pending" | "in_progress" | "completed" | "cancelled" | undefined,
      dueDate:
        body.dueDate === undefined ? undefined : typeof body.dueDate === "string" ? body.dueDate : null,
      projectId:
        body.projectId === undefined ? undefined : typeof body.projectId === "string" ? body.projectId : null,
      title: typeof body.title === "string" ? body.title : undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    return opsErrorResponse(error, "PATCH /api/operations/items/[id]");
  }
}
