/**
 * MCP Tools: Tasks
 *
 * CRUD operations for the task management system.
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

export function registerTaskTools(server: McpServer, ctx: ToolContext) {
  // ─── List Tasks ────────────────────────────────────────
  server.tool(
    "list_tasks",
    "List tasks with filtering by status, priority, project, or due date.",
    {
      status: z
        .enum(["pending", "in_progress", "completed", "cancelled"])
        .optional()
        .describe("Filter by status"),
      priority: z
        .enum(["low", "medium", "high", "urgent"])
        .optional()
        .describe("Filter by priority"),
      project_id: z.string().optional().describe("Filter by project"),
      due_before: z
        .string()
        .optional()
        .describe("Tasks due before this date (YYYY-MM-DD)"),
      due_after: z
        .string()
        .optional()
        .describe("Tasks due after this date (YYYY-MM-DD)"),
      limit: z.number().min(1).max(100).default(50).describe("Max results"),
    },
    async (params) => {
      const guard = ctx.guard("tasks:read");
      if (!guard.ok) return errorResult(guard);
      const userId = guard.userId;
      const conditions: string[] = ["t.user_id = ?"];
      const args: (string | number)[] = [userId];

      if (params.status) {
        conditions.push("t.status = ?");
        args.push(params.status);
      }
      if (params.priority) {
        conditions.push("t.priority = ?");
        args.push(params.priority);
      }
      if (params.project_id) {
        conditions.push("t.project_id = ?");
        args.push(params.project_id);
      }
      if (params.due_before) {
        conditions.push("t.due_date <= ?");
        args.push(params.due_before);
      }
      if (params.due_after) {
        conditions.push("t.due_date >= ?");
        args.push(params.due_after);
      }

      args.push(params.limit);

      const tasks = await query<Record<string, unknown>>(
        `SELECT t.*, p.name as project_name
         FROM tasks t
         LEFT JOIN projects p ON t.project_id = p.id
         WHERE ${conditions.join(" AND ")}
         ORDER BY
           CASE t.priority
             WHEN 'urgent' THEN 0
             WHEN 'high' THEN 1
             WHEN 'medium' THEN 2
             WHEN 'low' THEN 3
           END,
           t.due_date ASC NULLS LAST,
           t.created_at DESC
         LIMIT ?`,
        args
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ count: tasks.length, tasks }, null, 2),
          },
        ],
      };
    }
  );

  // ─── Create Task ───────────────────────────────────────
  server.tool(
    "create_task",
    "Create a new task with content, priority, due date, and optional project assignment.",
    {
      content: z.string().min(1).describe("Task description/content"),
      title: z.string().optional().describe("Optional task title"),
      priority: z
        .enum(["low", "medium", "high", "urgent"])
        .default("medium")
        .describe("Task priority"),
      due_date: z
        .string()
        .optional()
        .describe("Due date (YYYY-MM-DD)"),
      project_id: z.string().optional().describe("Assign to a project"),
      tags: z
        .array(z.string())
        .optional()
        .describe("Tags for the task"),
    },
    async (params) => {
      const guard = ctx.guard("tasks:write");
      if (!guard.ok) return errorResult(guard);
      const userId = guard.userId;

      const stamp = ctx.provenance();

      const result = await queryOne<{ id: string }>(
        `INSERT INTO tasks (user_id, content, title, priority, due_date, project_id, tags, ${stampColumns()})
         VALUES (?, ?, ?, ?, ?, ?, ?, ${stampPlaceholders()})
         RETURNING id`,
        [
          userId,
          params.content,
          params.title || null,
          params.priority,
          params.due_date || null,
          params.project_id || null,
          JSON.stringify(params.tags || []),
          ...stampValues(stamp),
        ]
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              task_id: result?.id,
              message: `Task created: "${params.content.substring(0, 80)}"`,
            }),
          },
        ],
      };
    }
  );

  // ─── Update Task ───────────────────────────────────────
  server.tool(
    "update_task",
    "Update task status, priority, content, or other fields.",
    {
      task_id: z.string().describe("Task ID to update"),
      content: z.string().optional().describe("New task content"),
      status: z
        .enum(["pending", "in_progress", "completed", "cancelled"])
        .optional()
        .describe("New status"),
      priority: z
        .enum(["low", "medium", "high", "urgent"])
        .optional()
        .describe("New priority"),
      due_date: z
        .string()
        .optional()
        .describe("New due date (YYYY-MM-DD or null to clear)"),
      project_id: z
        .string()
        .optional()
        .describe("Move to a different project"),
    },
    async (params) => {
      const guard = ctx.guard("tasks:write");
      if (!guard.ok) return errorResult(guard);
      const userId = guard.userId;

      const existing = await queryOne<{ id: string }>(
        "SELECT id FROM tasks WHERE id = ? AND user_id = ?",
        [params.task_id, userId]
      );
      if (!existing) {
        return {
          content: [{ type: "text" as const, text: "Task not found." }],
          isError: true,
        };
      }

      const sets: string[] = ["updated_at = datetime('now')"];
      const args: (string | number | null)[] = [];

      if (params.content !== undefined) {
        sets.push("content = ?");
        args.push(params.content);
      }
      if (params.status !== undefined) {
        sets.push("status = ?");
        args.push(params.status);
        if (params.status === "completed") {
          sets.push("completed_at = datetime('now')");
        }
      }
      if (params.priority !== undefined) {
        sets.push("priority = ?");
        args.push(params.priority);
      }
      if (params.due_date !== undefined) {
        sets.push("due_date = ?");
        args.push(params.due_date || null);
      }
      if (params.project_id !== undefined) {
        sets.push("project_id = ?");
        args.push(params.project_id || null);
      }

      args.push(params.task_id, userId);
      await db.execute(
        `UPDATE tasks SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`,
        args
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              message: `Task ${params.task_id} updated.`,
            }),
          },
        ],
      };
    }
  );

  // ─── Delete Task ───────────────────────────────────────
  server.tool(
    "delete_task",
    "Delete a task by ID. This is irreversible.",
    {
      task_id: z.string().describe("Task ID to delete"),
    },
    async (params) => {
      const guard = ctx.guard("tasks:write");
      if (!guard.ok) return errorResult(guard);
      const userId = guard.userId;

      const existing = await queryOne<{ id: string; content: string }>(
        "SELECT id, content FROM tasks WHERE id = ? AND user_id = ?",
        [params.task_id, userId]
      );
      if (!existing) {
        return {
          content: [{ type: "text" as const, text: "Task not found." }],
          isError: true,
        };
      }

      await db.execute("DELETE FROM tasks WHERE id = ? AND user_id = ?", [
        params.task_id,
        userId,
      ]);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              message: `Task deleted: "${existing.content.substring(0, 80)}"`,
            }),
          },
        ],
      };
    }
  );
}
