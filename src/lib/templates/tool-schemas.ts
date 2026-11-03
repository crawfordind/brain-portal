/**
 * Input shapes for the note-template MCP tools, shared by the registrations
 * (`src/mcp/tools/templates.ts`) and the catalog (`src/lib/mcp/catalog.ts`),
 * so the two cannot drift.
 *
 * Written for an assistant hearing "start this week's ops meeting note":
 * `list_note_templates`, then `create_note_from_template` with the id.
 */

import { z } from "zod";

export const listNoteTemplatesShape = {
  project_id: z.string().optional().describe("Put this project's templates first."),
};

export const suggestNoteTemplatesShape = {
  project_id: z
    .string()
    .optional()
    .describe("Look for recurring notes in this project. Omit to look across the account's own notes."),
};

export const createNoteTemplateShape = {
  name: z.string().min(1).max(120).describe("e.g. 'Weekly operations meeting'"),
  content: z
    .string()
    .max(100_000)
    .describe("The body every new note starts with (markdown or HTML). May use {{date}}, {{weekday}}, {{project}} etc."),
  title_pattern: z
    .string()
    .max(200)
    .optional()
    .describe("Title for new notes, e.g. 'Operations meeting {{date}}'. Defaults to the name plus {{date}}."),
  description: z.string().max(500).optional(),
  project_id: z.string().optional().describe("The project this template is for."),
  source_note_ids: z.array(z.string()).max(20).optional().describe("Notes the template was derived from, if any."),
};

export const createNoteFromTemplateShape = {
  template_id: z.string().describe("From list_note_templates."),
  project_id: z.string().optional().describe("Project for the new note. Defaults to the template's project."),
  title: z.string().max(200).optional().describe("Override the title the template would produce."),
  timezone: z
    .string()
    .optional()
    .describe("IANA zone for {{date}} and {{time}}, e.g. 'America/New_York'. Defaults to the user's saved zone, else UTC."),
};
