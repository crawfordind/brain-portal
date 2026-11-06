import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { completeWithMeta, parseJSONResponse } from "@/lib/ai/client";
import type { CompletionResult } from "@/lib/ai/client";
import { diagnoseError, redactSecrets } from "@/lib/system-health/diagnose";
import { getProjectAccess } from "@/lib/permissions";
import {
  listTemplates,
  loadReadableNotes,
  loadSeriesNotes,
  TemplateError,
} from "@/lib/templates/store";
import { readJsonBody, templateErrorResponse } from "@/lib/templates/http";
import { findSeries, sharedHeadings } from "@/lib/templates/series";
import {
  buildDescriptionPrompt,
  buildNotesPrompt,
  draftFromHeadings,
  DRAFT_SYSTEM,
  MAX_SAMPLE_NOTES,
  readDraftAnswer,
} from "@/lib/templates/ai";
import type { TemplateDraft } from "@/lib/templates/types";

const MODES = ["describe", "notes", "headings"] as const;
type Mode = (typeof MODES)[number];

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 50) : [];
}

// POST /api/templates/draft - propose a template; nothing is saved.
//   { mode: "describe", description, projectId? }        AI, from a sentence ("weekly operations meeting")
//   { mode: "notes", noteIds? | seriesKey, projectId?, instructions? }   AI, from notes the person wrote
//   { mode: "headings", seriesKey, projectId? }           no AI: the headings a series shares
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await readJsonBody(request);
  const mode = body?.mode as Mode;
  if (!body || !(MODES as readonly string[]).includes(mode)) {
    return NextResponse.json({ error: `mode must be one of ${MODES.join(", ")}` }, { status: 400 });
  }
  const projectId = typeof body.projectId === "string" && body.projectId ? body.projectId : null;

  try {
    let projectName: string | null = null;
    if (projectId) {
      const access = await getProjectAccess(projectId, user.id);
      if (!access) throw new TemplateError("Project not found", 404);
      projectName = access.project.name;
    }

    // Which notes a series is made of is the rules' call, recomputed here so
    // a client cannot name notes it could not read.
    const seriesFor = async (key: string) => {
      const { notes } = await loadSeriesNotes(user.id, projectId);
      const templates = await listTemplates(user.id).catch(() => []);
      const series = findSeries(notes, templates).find((s) => s.key === key);
      if (!series) throw new TemplateError("Those notes no longer look like a series. Refresh and try again.", 404);
      return { series, notes };
    };

    if (mode === "headings") {
      const key = typeof body.seriesKey === "string" ? body.seriesKey : "";
      if (!key) throw new TemplateError("seriesKey is required");
      const { series } = await seriesFor(key);
      const draft = draftFromHeadings({
        label: series.label,
        title_pattern: series.title_pattern,
        headings: series.shared_headings,
        noteIds: series.note_ids,
      });
      if (!draft) {
        throw new TemplateError("These notes don't share headings. Try “Draft with AI” instead.");
      }
      return NextResponse.json({ draft: { ...draft, project_id: projectId } });
    }

    let prompt: string;
    let source: TemplateDraft["source"];
    let sourceNoteIds: string[] = [];
    let fallbackName: string | undefined;

    if (mode === "describe") {
      const description = typeof body.description === "string" ? body.description.trim() : "";
      if (description.length < 3) throw new TemplateError("Say in a few words what the template is for");
      prompt = buildDescriptionPrompt(description, projectName);
      source = "ai_description";
      fallbackName = description.slice(0, 60);
    } else {
      let ids = strings(body.noteIds);
      let shared: string[] | undefined;
      if (!ids.length && typeof body.seriesKey === "string") {
        const { series } = await seriesFor(body.seriesKey);
        ids = series.note_ids;
        shared = series.shared_headings;
        fallbackName = series.label;
      }
      const notes = await loadReadableNotes(ids.slice(0, MAX_SAMPLE_NOTES), user.id);
      if (notes.length < 1) throw new TemplateError("Pick at least one note you can open");
      shared ??= sharedHeadings(notes.map((n) => n.content));
      prompt = buildNotesPrompt(notes, {
        projectName,
        sharedHeadings: shared,
        instructions: typeof body.instructions === "string" ? body.instructions : undefined,
      });
      source = "ai_notes";
      sourceNoteIds = notes.map((n) => n.id);
      fallbackName ??= notes[0].title;
    }

    const rl = await checkRateLimit({ maxRequests: 30, windowMs: 60 * 60 * 1000, bucket: "template-draft" });
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many template drafts. Try again later." }, { status: 429 });
    }

    let response: CompletionResult;
    try {
      response = await completeWithMeta(prompt, {
        system: DRAFT_SYSTEM,
        slot: "fast",
        userId: user.id,
        purpose: "Template draft",
        maxTokens: 2000,
      });
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      const diagnosis = diagnoseError(raw);
      const detail = diagnosis.code === "UNKNOWN_ERROR" ? ` Details: ${redactSecrets(raw).slice(0, 300)}` : "";
      return NextResponse.json(
        { error: `${diagnosis.title}. ${diagnosis.explanation}${detail}`, code: diagnosis.code },
        { status: 502 }
      );
    }

    let draft: TemplateDraft | null = null;
    try {
      draft = readDraftAnswer(parseJSONResponse(response.content), { source, sourceNoteIds, fallbackName });
    } catch {
      draft = null;
    }
    if (!draft) {
      return NextResponse.json({ error: "The model didn't return a usable template. Try again." }, { status: 502 });
    }
    return NextResponse.json({ draft: { ...draft, project_id: projectId }, model: response.model });
  } catch (error) {
    return templateErrorResponse(error, "Couldn't draft a template");
  }
}
