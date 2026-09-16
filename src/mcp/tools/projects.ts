/**
 * MCP Tools: Projects
 *
 * Project management operations.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { query, queryOne, db } from "../db";
import { errorResult, type ToolContext } from "../guard";

export function registerProjectTools(
  server: McpServer,
  ctx: ToolContext
) {
  // ─── List Projects ─────────────────────────────────────
  server.tool(
    "list_projects",
    "List all projects with their status, note count, and task count.",
    {
      status: z
        .enum(["active", "planning", "stalled", "completed", "archived"])
        .optional()
        .describe("Filter by project status"),
      include_stats: z
        .boolean()
        .default(true)
        .describe("Include note/task counts"),
    },
    async (params) => {
      const guard = ctx.guard("projects:read");
      if (!guard.ok) return errorResult(guard);
      const userId = guard.userId;
      const conditions: string[] = ["p.user_id = ?"];
      const args: (string | number)[] = [userId];

      if (params.status) {
        conditions.push("p.status = ?");
        args.push(params.status);
      }

      let sql: string;
      if (params.include_stats) {
        sql = `
          SELECT p.*,
            (SELECT COUNT(*) FROM notes n WHERE n.project_id = p.id AND n.is_archived = FALSE) as note_count,
            (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status != 'cancelled') as task_count,
            (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'completed') as completed_task_count
          FROM projects p
          WHERE ${conditions.join(" AND ")}
          ORDER BY p.priority DESC, p.updated_at DESC`;
      } else {
        sql = `
          SELECT p.*
          FROM projects p
          WHERE ${conditions.join(" AND ")}
          ORDER BY p.priority DESC, p.updated_at DESC`;
      }

      const projects = await query<Record<string, unknown>>(sql, args);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { count: projects.length, projects },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // ─── Get Project ───────────────────────────────────────
  server.tool(
    "get_project",
    "Get detailed project information including description, stats, recent notes, and pending tasks.",
    {
      project_id: z.string().describe("Project ID"),
    },
    async (params) => {
      const guard = ctx.guard("projects:read");
      if (!guard.ok) return errorResult(guard);
      const userId = guard.userId;

      const project = await queryOne<Record<string, unknown>>(
        "SELECT * FROM projects WHERE id = ? AND user_id = ?",
        [params.project_id, userId]
      );
      if (!project) {
        return {
          content: [{ type: "text" as const, text: "Project not found." }],
          isError: true,
        };
      }

      const [recentNotes, pendingTasks, stats] = await Promise.all([
        query<Record<string, unknown>>(
          `SELECT id, title, slug, note_type, updated_at
           FROM notes
           WHERE project_id = ? AND user_id = ? AND is_archived = FALSE
           ORDER BY updated_at DESC LIMIT 10`,
          [params.project_id, userId]
        ),
        query<Record<string, unknown>>(
          `SELECT id, content, status, priority, due_date
           FROM tasks
           WHERE project_id = ? AND user_id = ? AND status IN ('pending', 'in_progress')
           ORDER BY priority DESC, due_date ASC NULLS LAST
           LIMIT 20`,
          [params.project_id, userId]
        ),
        queryOne<Record<string, unknown>>(
          `SELECT
             (SELECT COUNT(*) FROM notes WHERE project_id = ? AND user_id = ? AND is_archived = FALSE) as total_notes,
             (SELECT COUNT(*) FROM tasks WHERE project_id = ? AND user_id = ?) as total_tasks,
             (SELECT COUNT(*) FROM tasks WHERE project_id = ? AND user_id = ? AND status = 'completed') as completed_tasks,
             (SELECT COUNT(*) FROM captures WHERE user_id = ? AND json_extract(linked_projects, '$') LIKE ?) as related_captures`,
          [
            params.project_id, userId,
            params.project_id, userId,
            params.project_id, userId,
            userId, `%${params.project_id}%`,
          ]
        ),
      ]);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { project, stats, recentNotes, pendingTasks },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // ─── Create Project ────────────────────────────────────
  server.tool(
    "create_project",
    "Create a new project with a name, description, and optional status/color.",
    {
      name: z.string().min(1).describe("Project name"),
      description: z.string().optional().describe("Project description"),
      status: z
        .enum(["active", "planning", "stalled", "completed", "archived"])
        .default("active")
        .describe("Initial status"),
      color: z.string().optional().describe("Hex color (e.g., #0d9488)"),
      parent_id: z.string().optional().describe("Parent project ID for nesting"),
    },
    async (params) => {
      const guard = ctx.guard("projects:write");
      if (!guard.ok) return errorResult(guard);
      const userId = guard.userId;
      const slug = params.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "")
        .substring(0, 100);

      const existing = await queryOne<{ id: string }>(
        "SELECT id FROM projects WHERE user_id = ? AND slug = ?",
        [userId, slug]
      );
      const finalSlug = existing ? `${slug}-${Date.now()}` : slug;

      const result = await queryOne<{ id: string }>(
        `INSERT INTO projects (user_id, name, slug, description, status, color, parent_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         RETURNING id`,
        [
          userId,
          params.name,
          finalSlug,
          params.description || null,
          params.status,
          params.color || "#0d9488",
          params.parent_id || null,
        ]
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              project_id: result?.id,
              slug: finalSlug,
              message: `Project "${params.name}" created.`,
            }),
          },
        ],
      };
    }
  );

  // ─── Update Project ────────────────────────────────────
  server.tool(
    "update_project",
    "Update project name, description, status, or color.",
    {
      project_id: z.string().describe("Project ID to update"),
      name: z.string().optional().describe("New name"),
      description: z.string().optional().describe("New description"),
      status: z
        .enum(["active", "planning", "stalled", "completed", "archived"])
        .optional()
        .describe("New status"),
      color: z.string().optional().describe("New hex color"),
    },
    async (params) => {
      const guard = ctx.guard("projects:write");
      if (!guard.ok) return errorResult(guard);
      const userId = guard.userId;

      const existing = await queryOne<{ id: string }>(
        "SELECT id FROM projects WHERE id = ? AND user_id = ?",
        [params.project_id, userId]
      );
      if (!existing) {
        return {
          content: [{ type: "text" as const, text: "Project not found." }],
          isError: true,
        };
      }

      const sets: string[] = ["updated_at = datetime('now')"];
      const args: (string | null)[] = [];

      if (params.name !== undefined) {
        sets.push("name = ?");
        args.push(params.name);
      }
      if (params.description !== undefined) {
        sets.push("description = ?");
        args.push(params.description);
      }
      if (params.status !== undefined) {
        sets.push("status = ?");
        args.push(params.status);
      }
      if (params.color !== undefined) {
        sets.push("color = ?");
        args.push(params.color);
      }

      args.push(params.project_id, userId);
      await db.execute(
        `UPDATE projects SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`,
        args
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              message: `Project ${params.project_id} updated.`,
            }),
          },
        ],
      };
    }
  );
}
