/**
 * Note templates: storage. Templates belong to one account; a project link
 * only says where a template is offered first. Every read and write is scoped
 * to the signed-in user.
 */

import { query, queryOne } from "@/lib/db/client";
import { getProjectAccess } from "@/lib/permissions";
import { getNoteAccess } from "@/lib/sharing/access";
import type { NoteTemplate, TemplateSource } from "./types";
import {
  MAX_TEMPLATE_CONTENT,
  MAX_TEMPLATE_DESCRIPTION,
  MAX_TEMPLATE_NAME,
  MAX_TEMPLATE_TITLE,
} from "./types";
import type { SeriesNote } from "./series";

export class TemplateError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 | 413 = 400
  ) {
    super(message);
    this.name = "TemplateError";
  }
}

const SOURCES: readonly TemplateSource[] = ["manual", "note", "ai_description", "ai_notes", "series"];

export interface TemplateInput {
  name?: unknown;
  description?: unknown;
  title_pattern?: unknown;
  content?: unknown;
  project_id?: unknown;
  source?: unknown;
  source_note_ids?: unknown;
}

const SELECT = `SELECT t.id, t.user_id, t.project_id, p.name AS project_name, t.name, t.description,
  t.title_pattern, t.content, t.source, t.use_count, t.last_used_at, t.created_at, t.updated_at
  FROM note_templates t LEFT JOIN projects p ON p.id = t.project_id`;

function text(value: unknown, max: number, field: string): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new TemplateError(`${field} must be text`);
  if (value.length > max) throw new TemplateError(`${field} is too long (max ${max.toLocaleString()} characters)`, 413);
  return value;
}

async function checkProject(projectId: unknown, userId: string): Promise<string | null> {
  if (projectId === undefined || projectId === null || projectId === "") return null;
  if (typeof projectId !== "string") throw new TemplateError("project_id must be text");
  const access = await getProjectAccess(projectId, userId);
  if (!access) throw new TemplateError("Project not found", 404);
  return projectId;
}

export async function listTemplates(userId: string, projectId?: string | null): Promise<NoteTemplate[]> {
  return query<NoteTemplate>(
    `${SELECT}
     WHERE t.user_id = ?
     ORDER BY (t.project_id IS NOT NULL AND t.project_id = ?) DESC, t.use_count DESC, t.updated_at DESC
     LIMIT 200`,
    [userId, projectId ?? ""]
  );
}

export async function getTemplate(id: string, userId: string): Promise<NoteTemplate> {
  const row = await queryOne<NoteTemplate>(`${SELECT} WHERE t.id = ? AND t.user_id = ?`, [id, userId]);
  if (!row) throw new TemplateError("Template not found", 404);
  return row;
}

export async function createTemplate(userId: string, input: TemplateInput): Promise<NoteTemplate> {
  const name = text(input.name, MAX_TEMPLATE_NAME, "Name").trim();
  if (!name) throw new TemplateError("A template needs a name");
  const description = text(input.description, MAX_TEMPLATE_DESCRIPTION, "Description").trim();
  const titlePattern = text(input.title_pattern, MAX_TEMPLATE_TITLE, "Title").trim();
  const content = text(input.content, MAX_TEMPLATE_CONTENT, "Content");
  const projectId = await checkProject(input.project_id, userId);
  const source = SOURCES.includes(input.source as TemplateSource) ? (input.source as TemplateSource) : "manual";
  const noteIds = Array.isArray(input.source_note_ids)
    ? input.source_note_ids.filter((x): x is string => typeof x === "string").slice(0, 20)
    : [];

  const row = await queryOne<{ id: string }>(
    `INSERT INTO note_templates (user_id, project_id, name, description, title_pattern, content, source, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING id`,
    [userId, projectId, name, description, titlePattern, content, source, JSON.stringify({ source_note_ids: noteIds })]
  );
  if (!row) throw new Error("Insert returned no row");
  return getTemplate(row.id, userId);
}

export async function updateTemplate(id: string, userId: string, input: TemplateInput): Promise<NoteTemplate> {
  await getTemplate(id, userId);
  const sets: string[] = [];
  const args: Array<string | null> = [];
  if (input.name !== undefined) {
    const name = text(input.name, MAX_TEMPLATE_NAME, "Name").trim();
    if (!name) throw new TemplateError("A template needs a name");
    sets.push("name = ?");
    args.push(name);
  }
  if (input.description !== undefined) {
    sets.push("description = ?");
    args.push(text(input.description, MAX_TEMPLATE_DESCRIPTION, "Description").trim());
  }
  if (input.title_pattern !== undefined) {
    sets.push("title_pattern = ?");
    args.push(text(input.title_pattern, MAX_TEMPLATE_TITLE, "Title").trim());
  }
  if (input.content !== undefined) {
    sets.push("content = ?");
    args.push(text(input.content, MAX_TEMPLATE_CONTENT, "Content"));
  }
  if (input.project_id !== undefined) {
    sets.push("project_id = ?");
    args.push(await checkProject(input.project_id, userId));
  }
  if (!sets.length) return getTemplate(id, userId);
  await query(
    `UPDATE note_templates SET ${sets.join(", ")}, updated_at = datetime('now') WHERE id = ? AND user_id = ?`,
    [...args, id, userId]
  );
  return getTemplate(id, userId);
}

export async function deleteTemplate(id: string, userId: string): Promise<void> {
  await getTemplate(id, userId);
  await query(`DELETE FROM note_templates WHERE id = ? AND user_id = ?`, [id, userId]);
}

/** Count a use. Leaves `updated_at` alone, so using a template doesn't read as editing it. */
export async function recordTemplateUse(id: string, userId: string): Promise<void> {
  await query(
    `UPDATE note_templates SET use_count = use_count + 1, last_used_at = datetime('now') WHERE id = ? AND user_id = ?`,
    [id, userId]
  );
}

/** Generated notes are not something a person writes from a template. */
const WRITTEN_TYPES = `('note', 'daily', 'journal')`;

/**
 * Notes to look for series in: a project's (any note in it the user can open)
 * or, without a project, the user's own. Newest first, bounded.
 */
export async function loadSeriesNotes(
  userId: string,
  projectId: string | null
): Promise<{ notes: SeriesNote[]; projectName: string | null }> {
  if (projectId) {
    const access = await getProjectAccess(projectId, userId);
    if (!access) throw new TemplateError("Project not found", 404);
    const notes = await query<SeriesNote>(
      `SELECT id, title, content, project_id, created_at FROM notes
       WHERE project_id = ? AND COALESCE(is_archived, 0) = 0 AND COALESCE(note_type, 'note') IN ${WRITTEN_TYPES}
       ORDER BY created_at DESC LIMIT 300`,
      [projectId]
    );
    return { notes, projectName: access.project.name };
  }
  const notes = await query<SeriesNote>(
    `SELECT id, title, content, project_id, created_at FROM notes
     WHERE user_id = ? AND COALESCE(is_archived, 0) = 0 AND COALESCE(note_type, 'note') IN ${WRITTEN_TYPES}
       AND slug NOT LIKE 'journal-%'
     ORDER BY created_at DESC LIMIT 400`,
    [userId]
  );
  return { notes, projectName: null };
}

/** Notes by id, each only if this user may open it. Unreadable ids are dropped. */
export async function loadReadableNotes(
  ids: string[],
  userId: string
): Promise<Array<{ id: string; title: string; content: string; created_at: string; project_id: string | null }>> {
  const out: Array<{ id: string; title: string; content: string; created_at: string; project_id: string | null }> = [];
  for (const id of [...new Set(ids)].slice(0, 12)) {
    const access = await getNoteAccess(id, userId);
    if (!access) continue;
    const n = access.note as unknown as {
      id: string;
      title: string;
      content: string;
      created_at: string;
      project_id: string | null;
    };
    out.push({ id: n.id, title: n.title, content: n.content, created_at: n.created_at, project_id: n.project_id });
  }
  return out;
}
