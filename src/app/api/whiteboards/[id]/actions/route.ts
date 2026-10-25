import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { completeWithMeta, parseJSONResponse } from "@/lib/ai/client";
import {
  convertItemsToTasks,
  groupItems,
  loadItems,
  readBoard,
  saveBoardAsNote,
  tidyBoard,
  WhiteboardError,
} from "@/lib/whiteboards/store";
import { readJsonBody, whiteboardErrorResponse } from "@/lib/whiteboards/http";
import {
  buildOrganizePrompt,
  MAX_ORGANIZE_ITEMS,
  ORGANIZE_SYSTEM,
  readOrganizeAnswer,
} from "@/lib/whiteboards/organize";
import { frameOf } from "@/lib/whiteboards/layout";
import { diagnoseError, redactSecrets } from "@/lib/system-health/diagnose";
import type { CompletionResult } from "@/lib/ai/client";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const ACTIONS = ["tidy", "organize", "convert_to_tasks", "save_as_note"] as const;
type Action = (typeof ACTIONS)[number];

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 500) : [];
}

// POST /api/whiteboards/[id]/actions - { action, itemIds?, title? }
//   tidy              line up frames' contents and loose items
//   organize          AI proposes themes for the stickies (selected, else loose); frames are made for them
//   convert_to_tasks  stickies/text/shapes → tasks in the board's project, swapped for task cards
//   save_as_note      the board as a markdown note in the same project
export async function POST(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await readJsonBody(request);
  const action = body?.action as Action;
  if (!body || !(ACTIONS as readonly string[]).includes(action)) {
    return NextResponse.json({ error: `action must be one of ${ACTIONS.join(", ")}` }, { status: 400 });
  }
  const { id } = await params;

  try {
    switch (action) {
      case "tidy":
        return NextResponse.json(await tidyBoard(id, user.id));

      case "convert_to_tasks":
        return NextResponse.json(await convertItemsToTasks(id, user.id, strings(body.itemIds)));

      case "save_as_note":
        return NextResponse.json({
          note: await saveBoardAsNote(id, user.id, undefined, typeof body.title === "string" ? body.title : undefined),
        });

      case "organize": {
        const rl = await checkRateLimit({ maxRequests: 20, windowMs: 60 * 60 * 1000, bucket: "whiteboard-organize" });
        if (!rl.allowed) return NextResponse.json({ error: "Too many organise requests. Try again later." }, { status: 429 });

        const view = await readBoard(id, user.id);
        if (view.access.role === "viewer") throw new WhiteboardError("You can view this whiteboard but not change it", 403);
        const selected = new Set(strings(body.itemIds));
        const items = await loadItems(id);
        const pool = items.filter(
          (i) =>
            (i.kind === "sticky" || i.kind === "text" || i.kind === "shape" || i.kind === "card") &&
            (selected.size ? selected.has(i.id) : !frameOf(i, items))
        );
        const candidates = pool
          .map((i) => ({
            id: i.id,
            text: i.kind === "card" ? view.refs[`${i.ref_type}:${i.ref_id}`]?.title ?? i.text : i.text,
          }))
          .filter((c) => c.text.trim())
          .slice(0, MAX_ORGANIZE_ITEMS);
        if (candidates.length < 3) {
          return NextResponse.json(
            { error: "Organising needs at least three items with words in them, outside a frame or selected." },
            { status: 400 }
          );
        }

        let response: CompletionResult;
        try {
          response = await completeWithMeta(buildOrganizePrompt(view.board.title, candidates), {
            system: ORGANIZE_SYSTEM,
            slot: "fast",
            userId: user.id,
            purpose: "Whiteboard organise",
            maxTokens: 2000,
          });
        } catch (error) {
          // Say why in words the user can act on ("add a key in Settings"),
          // not a provider status code.
          const raw = error instanceof Error ? error.message : String(error);
          const diagnosis = diagnoseError(raw);
          const detail = diagnosis.code === "UNKNOWN_ERROR" ? ` Details: ${redactSecrets(raw).slice(0, 300)}` : "";
          return NextResponse.json(
            { error: `${diagnosis.title}. ${diagnosis.explanation}${detail}`, code: diagnosis.code },
            { status: 502 }
          );
        }
        let groups: ReturnType<typeof readOrganizeAnswer>;
        try {
          groups = readOrganizeAnswer(parseJSONResponse(response.content), candidates);
        } catch {
          groups = [];
        }
        if (!groups.length) {
          return NextResponse.json({ error: "The model didn't return usable groups. Try again." }, { status: 502 });
        }
        const result = await groupItems(id, user.id, groups);
        return NextResponse.json({ ...result, model: response.model });
      }
    }
  } catch (error) {
    return whiteboardErrorResponse(error, "That didn't work on the whiteboard");
  }
}
