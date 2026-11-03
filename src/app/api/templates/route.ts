import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createTemplate, listTemplates, TemplateError } from "@/lib/templates/store";
import { readJsonBody, templateErrorResponse } from "@/lib/templates/http";
import { getNoteAccess } from "@/lib/sharing/access";
import { structureOnly } from "@/lib/templates/content";
import { seriesLabel } from "@/lib/templates/series";

// GET /api/templates?projectId= - the account's templates; that project's first
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const projectId = new URL(request.url).searchParams.get("projectId");
  try {
    return NextResponse.json({ templates: await listTemplates(user.id, projectId) });
  } catch (error) {
    return templateErrorResponse(error, "Couldn't load templates");
  }
}

// POST /api/templates - { name, description?, title_pattern?, content?, project_id?, source?, source_note_ids? }
//   or { fromNoteId, structureOnly?, name? } to save an existing note as a template
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await readJsonBody(request);
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  try {
    if (typeof body.fromNoteId === "string") {
      const access = await getNoteAccess(body.fromNoteId, user.id);
      if (!access) throw new TemplateError("Note not found", 404);
      const note = access.note as unknown as { id: string; title: string; content: string; project_id: string | null };
      const content = body.structureOnly ? structureOnly(note.content) : note.content;
      if (body.structureOnly && !content) {
        throw new TemplateError("This note has no headings to keep. Save it with its text instead.");
      }
      const label = seriesLabel(note.title) || note.title;
      const template = await createTemplate(user.id, {
        name: typeof body.name === "string" && body.name.trim() ? body.name : label,
        description: body.description,
        title_pattern: typeof body.title_pattern === "string" ? body.title_pattern : `${label} {{date}}`,
        content,
        project_id: access.via === "owner" || access.via === "project" ? note.project_id : null,
        source: "note",
        source_note_ids: [note.id],
      });
      return NextResponse.json({ template }, { status: 201 });
    }
    const template = await createTemplate(user.id, body);
    return NextResponse.json({ template }, { status: 201 });
  } catch (error) {
    return templateErrorResponse(error, "Couldn't save the template");
  }
}
