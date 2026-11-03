/**
 * MCP Tools: note templates.
 *
 * Templates are the account's own; a project only says where one is offered
 * first. `suggest_note_templates` runs the same rules as the web app
 * (`findSeries`): no model is called, and the assistant drafts from the notes
 * it names if it wants to.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { queryOne } from "../db";
import { errorResult, type ToolContext } from "../guard";
import { stampColumns, stampPlaceholders, stampValues } from "@/lib/provenance";
import { getProjectAccess } from "@/lib/permissions";
import {
  createTemplate,
  getTemplate,
  listTemplates,
  loadSeriesNotes,
  recordTemplateUse,
  TemplateError,
} from "@/lib/templates/store";
import { isMissingTemplateTable } from "@/lib/templates/schema";
import { findSeries } from "@/lib/templates/series";
import { renderTemplate } from "@/lib/templates/variables";
import {
  createNoteFromTemplateShape,
  createNoteTemplateShape,
  listNoteTemplatesShape,
  suggestNoteTemplatesShape,
} from "@/lib/templates/tool-schemas";

function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function failure(error: unknown) {
  const message =
    error instanceof TemplateError
      ? error.message
      : isMissingTemplateTable(error)
        ? "Templates aren't set up on this server yet. The operator needs to run `npm run db:migrate`."
        : "That didn't work";
  if (!(error instanceof TemplateError) && !isMissingTemplateTable(error)) console.error("[MCP templates]", error);
  return { ...json({ error: "template_error", message }), isError: true };
}

const looksLikeHtml = (text: string) => /<[a-z][\s\S]*>/i.test(text);

export function registerTemplateTools(server: McpServer, ctx: ToolContext) {
  server.tool(
    "list_note_templates",
    "List the user's note templates (e.g. a weekly operations meeting), the given project's first, then most used.",
    listNoteTemplatesShape,
    async (params) => {
      const guard = ctx.guard("notes:read");
      if (!guard.ok) return errorResult(guard);
      try {
        const templates = await listTemplates(guard.userId, params.project_id ?? null);
        return json({
          templates: templates.map((t) => ({
            id: t.id,
            name: t.name,
            description: t.description,
            title_pattern: t.title_pattern,
            project_id: t.project_id,
            project_name: t.project_name,
            use_count: t.use_count,
          })),
        });
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.tool(
    "suggest_note_templates",
    "Find notes the user writes again and again (same title with different dates, shared headings) that would make a good template. Rule-based; returns note ids, cadence, shared headings and reasons.",
    suggestNoteTemplatesShape,
    async (params) => {
      const guard = ctx.guard("notes:read");
      if (!guard.ok) return errorResult(guard);
      try {
        const { notes } = await loadSeriesNotes(guard.userId, params.project_id ?? null);
        const templates = await listTemplates(guard.userId).catch(() => []);
        const series = findSeries(notes, templates).slice(0, 10);
        return json({
          scanned: notes.length,
          suggestions: series.map((s) => ({
            label: s.label,
            project_id: s.project_id,
            count: s.count,
            cadence: s.cadence,
            title_pattern: s.title_pattern,
            shared_headings: s.shared_headings,
            reasons: s.reasons,
            has_template: s.has_template,
            note_ids: s.note_ids.slice(0, 8),
          })),
        });
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.tool(
    "create_note_template",
    "Save a note template the user asked for. Content may use {{date}}, {{date_long}}, {{date+7}}, {{weekday}}, {{time}}, {{week}}, {{month}}, {{year}}, {{project}}.",
    createNoteTemplateShape,
    async (params) => {
      const guard = ctx.guard("notes:write");
      if (!guard.ok) return errorResult(guard);
      try {
        const template = await createTemplate(guard.userId, {
          name: params.name,
          description: params.description ?? "",
          title_pattern: params.title_pattern ?? `${params.name} {{date}}`,
          content: params.content,
          project_id: params.project_id ?? null,
          source: params.source_note_ids?.length ? "ai_notes" : "ai_description",
          source_note_ids: params.source_note_ids ?? [],
        });
        return json({ success: true, template_id: template.id, message: `Template "${template.name}" saved.` });
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.tool(
    "create_note_from_template",
    "Create a new note from one of the user's templates, with its date and project variables filled in. Returns the note id.",
    createNoteFromTemplateShape,
    async (params) => {
      const guard = ctx.guard("notes:write");
      if (!guard.ok) return errorResult(guard);
      const userId = guard.userId;
      try {
        const template = await getTemplate(params.template_id, userId);
        const projectId = params.project_id ?? template.project_id ?? null;
        let projectName: string | null = null;
        if (projectId) {
          const access = await getProjectAccess(projectId, userId);
          if (!access || access.role === "viewer") throw new TemplateError("Project not found or not editable", 404);
          projectName = access.project.name;
        }
        let timeZone = params.timezone;
        if (!timeZone) {
          const pref = await queryOne<{ timezone: string | null }>(
            `SELECT timezone FROM notification_preferences WHERE user_id = ?`,
            [userId]
          ).catch(() => null);
          timeZone = pref?.timezone || "UTC";
        }
        const ctxVars = { now: new Date(), timeZone, projectName };
        const title = (params.title?.trim() || renderTemplate(template.title_pattern || template.name, ctxVars)).slice(0, 200);
        const content = renderTemplate(template.content, ctxVars, { html: looksLikeHtml(template.content) });
        const base =
          title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/(^-|-$)/g, "")
            .substring(0, 100) || "note";
        const clash = await queryOne<{ id: string }>("SELECT id FROM notes WHERE user_id = ? AND slug = ?", [userId, base]);
        const slug = clash ? `${base}-${Date.now()}` : base;
        const plain = content.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
        const note = await queryOne<{ id: string }>(
          `INSERT INTO notes (user_id, title, slug, content, content_plain, note_type, project_id, word_count, metadata, ${stampColumns()})
           VALUES (?, ?, ?, ?, ?, 'note', ?, ?, ?, ${stampPlaceholders()})
           RETURNING id`,
          [
            userId,
            title,
            slug,
            content,
            plain,
            projectId,
            plain.split(/\s+/).filter(Boolean).length,
            JSON.stringify({ template_id: template.id }),
            ...stampValues(ctx.provenance()),
          ]
        );
        await recordTemplateUse(template.id, userId).catch(() => {});
        return json({ success: true, note_id: note?.id, slug, title, message: `Note "${title}" created from "${template.name}".` });
      } catch (error) {
        return failure(error);
      }
    }
  );
}
