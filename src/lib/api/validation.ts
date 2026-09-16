import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";

export async function safeParseJson(
  request: NextRequest
): Promise<Record<string, unknown> | NextResponse> {
  try {
    return await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
}

export function isErrorResponse(
  result: Record<string, unknown> | NextResponse
): result is NextResponse {
  return result instanceof NextResponse;
}

const VALID_TASK_STATUSES = ["pending", "in_progress", "completed", "cancelled"] as const;
const VALID_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
const VALID_CAPTURE_TYPES = ["thought", "idea", "link", "reference", "voice", "image"] as const;
const VALID_REMINDER_STATUSES = ["pending", "triggered", "dismissed", "snoozed"] as const;

export type TaskStatus = (typeof VALID_TASK_STATUSES)[number];
export type Priority = (typeof VALID_PRIORITIES)[number];
export type CaptureType = (typeof VALID_CAPTURE_TYPES)[number];
export type ReminderStatus = (typeof VALID_REMINDER_STATUSES)[number];

export function isValidTaskStatus(s: unknown): s is TaskStatus {
  return typeof s === "string" && (VALID_TASK_STATUSES as readonly string[]).includes(s);
}

export function isValidPriority(p: unknown): p is Priority {
  return typeof p === "string" && (VALID_PRIORITIES as readonly string[]).includes(p);
}

export function isValidCaptureType(t: unknown): t is CaptureType {
  return typeof t === "string" && (VALID_CAPTURE_TYPES as readonly string[]).includes(t);
}

export function isValidReminderStatus(s: unknown): s is ReminderStatus {
  return typeof s === "string" && (VALID_REMINDER_STATUSES as readonly string[]).includes(s);
}

export function verifyCronSecret(request: NextRequest): NextResponse | null {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret) {
    const expected = `Bearer ${cronSecret}`;
    if (
      !authHeader ||
      authHeader.length !== expected.length ||
      !timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected))
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return null;
  }

  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 401 });
  }

  return null;
}
