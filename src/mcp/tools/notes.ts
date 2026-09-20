/**
 * MCP Tools: Notes
 *
 * Full CRUD + search for the notes system.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { query, queryOne, db } from "../db";
import { errorResult, type ToolContext } from "../guard";
import {
  stampColumns,
  stampPlaceholders,
  stampValues,
} from "@/lib/provenance";

export function registerNoteTools(server: McpServer, ctx: ToolContext) {
  // ─── List Notes ────────────────────────────────────────
  server.tool(
    "list_notes",
    "List notes with optional filtering by project, type, or search query. Returns titles, IDs, types, and metadata.",
    {
      project_id: z.string().optional().describe("Filter by project ID"),
      note_type: z
        .enum(["note", "daily", "weekly", "insight", "journal"])
        .optional()
        .describe("Filter by note type"),
      search: z.string().optional().describe("Full-text search query"),
      is_pinned: z.boolean().optional().describe("Filter pinned notes only"),
      limit: z.number().min(1).max(100).default(25).describe("Max results (default 25)"),
      offset: z.number().min(0).default(0).describe("Pagination offset"),
    },
    async (params) => {
      const guard = ctx.guard("notes:read");
      if (!guard.ok) return errorResult(guard);
      const userId = guard.userId;
      const conditions: string[] = ["n.user_id = ?"];
      const args: (string | number | boolean)[] = [userId];

      if (params.project_id) {
        conditions.push("n.project_id = ?");
        args.push(params.project_id);
      }
      if (params.note_type) {
        conditions.push("n.note_type = ?");
        args.push(params.note_type);
      }
      if (params.is_pinned !== undefined) {
        conditions.push("n.is_pinned = ?");
        args.push(params.is_pinned ? 1 : 0);
      }

      let sql: string;
      if (params.search) {
        sql = `
          SELECT n.id, n.title, n.slug, n.note_type, n.project_id,
                 n.is_pinned, n.word_count, n.created_at, n.updated_at,
                 p.name as project_name, n.summary
          FROM notes n
          LEFT JOIN projects p ON n.project_id = p.id
          JOIN notes_fts ON notes_fts.rowid = n.rowid
          WHERE ${conditions.join(" AND ")}
            AND notes_fts MATCH ?
            AND n.is_archived = FALSE
          ORDER BY rank
          LIMIT ? OFFSET ?`;
        args.push(params.search, params.limit, params.offset);
      } else {
        sql = `
          SELECT n.id, n.title, n.slug, n.note_type, n.project_id,
                 n.is_pinned, n.word_count, n.created_at, n.updated_at,
                 p.name as project_name, n.summary
          FROM notes n
          LEFT JOIN projects p ON n.project_id = p.id
          WHERE ${conditions.join(" AND ")}
            AND n.is_archived = FALSE
          ORDER BY n.updated_at DESC
          LIMIT ? OFFSET ?`;
        args.push(params.limit, params.offset);
      }

      const notes = await query<Record<string, unknown>>(sql, args);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { count: notes.length, notes },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // ─── Get Note ──────────────────────────────────────────
  server.tool(
    "get_note",
    "Get a single note by ID with full content, tags, and connections.",
    {
      note_id: z.string().describe("The note ID to retrieve"),
      include_connections: z
        .boolean()
        .default(false)
        .describe("Include related note connections"),
    },
    async (params) => {
      const guard = ctx.guard("notes:read");
      if (!guard.ok) return errorResult(guard);
      const userId = guard.userId;

      const note = await queryOne<Record<string, unknown>>(
        `SELECT n.*, p.name as project_name
         FROM notes n
         LEFT JOIN projects p ON n.project_id = p.id
         WHERE n.id = ? AND n.user_id = ?`,
        [params.note_id, userId]
      );

      if (!note) {
        return {
          content: [{ type: "text" as const, text: "Note not found." }],
          isError: true,
        };
      }

      // Get tags
      const tags = await query<{ name: string; slug: string }>(
        `SELECT t.name, t.slug FROM tags t
         JOIN note_tags nt ON t.id = nt.tag_id
         WHERE nt.note_id = ?`,
        [params.note_id]
      );

      let connections: Record<string, unknown>[] = [];
      if (params.include_connections) {
        connections = await query<Record<string, unknown>>(
          `SELECT nc.*, n.title as connected_title, n.slug as connected_slug
           FROM note_connections nc
           JOIN notes n ON (
             CASE WHEN nc.source_note_id = ? THEN nc.target_note_id
                  ELSE nc.source_note_id END
           ) = n.id
           WHERE nc.source_note_id = ? OR nc.target_note_id = ?`,
          [params.note_id, params.note_id, params.note_id]
        );
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ note, tags, connections }, null, 2),
          },
        ],
      };
    }
  );

  // ─── Create Note ───────────────────────────────────────
  server.tool(
    "create_note",
    "Create a new note. Returns the created note with its ID.",
    {
      title: z.string().min(1).describe("Note title"),
      content: z.string().describe("Note content (markdown)"),
      note_type: z
        .enum(["note", "daily", "weekly", "insight", "journal"])
        .default("note")
        .describe("Type of note"),
      project_id: z.string().optional().describe("Assign to a project"),
      is_pinned: z.boolean().default(false).describe("Pin this note"),
    },
    async (params) => {
      const guard = ctx.guard("notes:write");
      if (!guard.ok) return errorResult(guard);
      const userId = guard.userId;
      const slug = params.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "")
        .substring(0, 100);

      // Ensure unique slug
      const existing = await queryOne<{ id: string }>(
        "SELECT id FROM notes WHERE user_id = ? AND slug = ?",
        [userId, slug]
      );
      const finalSlug = existing ? `${slug}-${Date.now()}` : slug;

      const contentPlain = params.content.replace(/<[^>]*>/g, "");
      const wordCount = contentPlain.split(/\s+/).filter(Boolean).length;

      // Who wrote this, and which job it came out of. One long agent run
      // writing fifty notes stamps the same run id on all fifty, so the
      // stream can render them as one row instead of burying the user's own
      // work under them.
      const stamp = ctx.provenance();

      const result = await queryOne<{ id: string }>(
        `INSERT INTO notes (user_id, title, slug, content, content_plain, note_type, project_id, is_pinned, word_count, ${stampColumns()})
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${stampPlaceholders()})
         RETURNING id`,
        [
          userId,
          params.title,
          finalSlug,
          params.content,
          contentPlain,
          params.note_type,
          params.project_id || null,
          params.is_pinned ? 1 : 0,
          wordCount,
          ...stampValues(stamp),
        ]
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: true,
                note_id: result?.id,
                slug: finalSlug,
                message: `Note "${params.title}" created.`,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // ─── Update Note ───────────────────────────────────────
  server.tool(
    "update_note",
    "Update an existing note's title, content, or metadata.",
    {
      note_id: z.string().describe("The note ID to update"),
      title: z.string().optional().describe("New title"),
      content: z.string().optional().describe("New content (markdown)"),
      project_id: z.string().optional().describe("Move to a different project"),
      is_pinned: z.boolean().optional().describe("Pin/unpin"),
      is_archived: z.boolean().optional().describe("Archive/unarchive"),
    },
    async (params) => {
      const guard = ctx.guard("notes:write");
      if (!guard.ok) return errorResult(guard);
      const userId = guard.userId;

      // Verify ownership
      const existing = await queryOne<{ id: string }>(
        "SELECT id FROM notes WHERE id = ? AND user_id = ?",
        [params.note_id, userId]
      );
      if (!existing) {
        return {
          content: [{ type: "text" as const, text: "Note not found." }],
          isError: true,
        };
      }

      const sets: string[] = ["updated_at = datetime('now')"];
      const args: (string | number | null)[] = [];

      if (params.title !== undefined) {
        sets.push("title = ?");
        args.push(params.title);
      }
      if (params.content !== undefined) {
        sets.push("content = ?");
        args.push(params.content);
        const contentPlain = params.content.replace(/<[^>]*>/g, "");
        sets.push("content_plain = ?");
        args.push(contentPlain);
        sets.push("word_count = ?");
        args.push(contentPlain.split(/\s+/).filter(Boolean).length);
      }
      if (params.project_id !== undefined) {
        sets.push("project_id = ?");
        args.push(params.project_id);
      }
      if (params.is_pinned !== undefined) {
        sets.push("is_pinned = ?");
        args.push(params.is_pinned ? 1 : 0);
      }
      if (params.is_archived !== undefined) {
        sets.push("is_archived = ?");
        args.push(params.is_archived ? 1 : 0);
      }

      args.push(params.note_id, userId);
      await db.execute(
        `UPDATE notes SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`,
        args
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              message: `Note ${params.note_id} updated.`,
            }),
          },
        ],
      };
    }
  );

  // ─── Delete Note ───────────────────────────────────────
  server.tool(
    "delete_note",
    "Delete a note by ID. This is irreversible.",
    {
      note_id: z.string().describe("The note ID to delete"),
    },
    async (params) => {
      const guard = ctx.guard("notes:write");
      if (!guard.ok) return errorResult(guard);
      const userId = guard.userId;
      const existing = await queryOne<{ id: string; title: string }>(
        "SELECT id, title FROM notes WHERE id = ? AND user_id = ?",
        [params.note_id, userId]
      );
      if (!existing) {
        return {
          content: [{ type: "text" as const, text: "Note not found." }],
          isError: true,
        };
      }

      await db.execute("DELETE FROM notes WHERE id = ? AND user_id = ?", [
        params.note_id,
        userId,
      ]);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              message: `Note "${existing.title}" deleted.`,
            }),
          },
        ],
      };
    }
  );
}
