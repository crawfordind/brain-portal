/**
 * MCP Tools: Search
 *
 * Unified full-text search across all entity types.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { query } from "../db";
import { errorResult, type ToolContext } from "../guard";

export function registerSearchTools(
  server: McpServer,
  ctx: ToolContext
) {
  // ─── Full-Text Search ──────────────────────────────────
  server.tool(
    "search",
    "Full-text search across notes, tasks, captures, and projects. Uses SQLite FTS5 for fast keyword matching.",
    {
      query: z.string().min(1).describe("Search query"),
      entity_types: z
        .array(z.enum(["notes", "tasks", "captures", "projects"]))
        .default(["notes", "tasks", "captures", "projects"])
        .describe("Entity types to search"),
      limit: z.number().min(1).max(50).default(20).describe("Max results per type"),
    },
    async (params) => {
      const guard = ctx.guard("search:read");
      if (!guard.ok) return errorResult(guard);
      const userId = guard.userId;
      const results: Record<string, unknown[]> = {};

      if (params.entity_types.includes("notes")) {
        results.notes = await query<Record<string, unknown>>(
          `SELECT n.id, n.title, n.slug, n.note_type, n.summary,
                  n.updated_at, p.name as project_name
           FROM notes n
           LEFT JOIN projects p ON n.project_id = p.id
           JOIN notes_fts ON notes_fts.rowid = n.rowid
           WHERE n.user_id = ? AND notes_fts MATCH ? AND n.is_archived = FALSE
           ORDER BY rank
           LIMIT ?`,
          [userId, params.query, params.limit]
        );
      }

      if (params.entity_types.includes("tasks")) {
        results.tasks = await query<Record<string, unknown>>(
          `SELECT id, content, title, status, priority, due_date, updated_at
           FROM tasks
           WHERE user_id = ? AND content LIKE ?
           ORDER BY updated_at DESC
           LIMIT ?`,
          [userId, `%${params.query}%`, params.limit]
        );
      }

      if (params.entity_types.includes("captures")) {
        results.captures = await query<Record<string, unknown>>(
          `SELECT id, content, capture_type, captured_at
           FROM captures
           WHERE user_id = ? AND content LIKE ?
           ORDER BY captured_at DESC
           LIMIT ?`,
          [userId, `%${params.query}%`, params.limit]
        );
      }

      if (params.entity_types.includes("projects")) {
        results.projects = await query<Record<string, unknown>>(
          `SELECT id, name, slug, description, status
           FROM projects
           WHERE user_id = ? AND (name LIKE ? OR description LIKE ?)
           ORDER BY updated_at DESC
           LIMIT ?`,
          [userId, `%${params.query}%`, `%${params.query}%`, params.limit]
        );
      }

      const totalCount = Object.values(results).reduce(
        (sum, arr) => sum + arr.length,
        0
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { total_results: totalCount, results },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // ─── Activity Feed ─────────────────────────────────────
  server.tool(
    "recent_activity",
    "Get recent activity across all entity types: recently modified notes, new tasks, captures, and agent tasks.",
    {
      days: z
        .number()
        .min(1)
        .max(30)
        .default(3)
        .describe("Number of days to look back"),
      limit: z
        .number()
        .min(1)
        .max(50)
        .default(20)
        .describe("Max results"),
    },
    async (params) => {
      const guard = ctx.guard("search:read");
      if (!guard.ok) return errorResult(guard);
      const userId = guard.userId;

      const [recentNotes, recentTasks, recentCaptures, agentTasks] =
        await Promise.all([
          query<Record<string, unknown>>(
            `SELECT 'note' as entity_type, id, title as label, updated_at as timestamp
             FROM notes
             WHERE user_id = ? AND updated_at > datetime('now', ? || ' days')
             ORDER BY updated_at DESC LIMIT ?`,
            [userId, -params.days, params.limit]
          ),
          query<Record<string, unknown>>(
            `SELECT 'task' as entity_type, id, content as label, updated_at as timestamp
             FROM tasks
             WHERE user_id = ? AND updated_at > datetime('now', ? || ' days')
             ORDER BY updated_at DESC LIMIT ?`,
            [userId, -params.days, params.limit]
          ),
          query<Record<string, unknown>>(
            `SELECT 'capture' as entity_type, id, content as label, captured_at as timestamp
             FROM captures
             WHERE user_id = ? AND captured_at > datetime('now', ? || ' days')
             ORDER BY captured_at DESC LIMIT ?`,
            [userId, -params.days, params.limit]
          ),
          query<Record<string, unknown>>(
            `SELECT 'agent_task' as entity_type, id, title as label, status, updated_at as timestamp
             FROM agent_tasks
             WHERE user_id = ? AND updated_at > datetime('now', ? || ' days')
             ORDER BY updated_at DESC LIMIT ?`,
            [userId, -params.days, params.limit]
          ),
        ]);

      const allActivity = [
        ...recentNotes,
        ...recentTasks,
        ...recentCaptures,
        ...agentTasks,
      ].sort(
        (a, b) =>
          new Date(b.timestamp as string).getTime() -
          new Date(a.timestamp as string).getTime()
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { count: allActivity.length, activity: allActivity.slice(0, params.limit) },
              null,
              2
            ),
          },
        ],
      };
    }
  );
}
