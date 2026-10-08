import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { safeParseJson, isErrorResponse } from "@/lib/api/validation";
import { actOnCapture, type ConfirmInput, type IntakeAction } from "@/lib/operations/intake";
import { normalizeDate } from "@/lib/operations/fields";
import { opsErrorResponse } from "../../errors";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const KINDS = ["action", "decision", "waiting", "commitment", "reference", "context"];

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * POST /api/operations/intake/[id]
 *
 *   { action: "confirm", kind, title?, dueDate?, projectId?, counterparty?, direction?, options? }
 *   { action: "file", kind?: "reference"|"context", projectId? }
 *   { action: "dismiss" }
 *   { action: "reopen" }   — the undo for all three
 *
 * Confirm is the only path from a capture to a commitment, and it always
 * takes an explicit request from the user.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await safeParseJson(request);
  if (isErrorResponse(body)) return body;

  let action: IntakeAction;
  switch (body.action) {
    case "confirm": {
      if (typeof body.kind !== "string" || !KINDS.includes(body.kind)) {
        return NextResponse.json({ error: `kind must be one of ${KINDS.join(", ")}` }, { status: 400 });
      }
      if (body.dueDate && !normalizeDate(body.dueDate)) {
        return NextResponse.json({ error: "dueDate must be YYYY-MM-DD" }, { status: 400 });
      }
      const input: ConfirmInput = {
        kind: body.kind as ConfirmInput["kind"],
        title: str(body.title) ?? undefined,
        dueDate: str(body.dueDate),
        projectId: str(body.projectId),
        counterparty: str(body.counterparty),
        counterpartyEntityId: str(body.counterpartyEntityId),
        direction:
          body.direction === "they_owe" ? "they_owe" : body.direction === "i_owe" ? "i_owe" : null,
        options: Array.isArray(body.options)
          ? body.options.filter((o): o is string => typeof o === "string")
          : undefined,
      };
      action = { action: "confirm", input };
      break;
    }
    case "file":
      action = {
        action: "file",
        projectId: str(body.projectId),
        kind: body.kind === "context" ? "context" : "reference",
      };
      break;
    case "dismiss":
      action = { action: "dismiss" };
      break;
    case "reopen":
      action = { action: "reopen" };
      break;
    default:
      return NextResponse.json(
        { error: "action must be confirm, file, dismiss or reopen" },
        { status: 400 }
      );
  }

  try {
    return NextResponse.json(await actOnCapture(user.id, id, action));
  } catch (error) {
    return opsErrorResponse(error, "POST /api/operations/intake/[id]");
  }
}
