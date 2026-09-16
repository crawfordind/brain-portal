/**
 * MCP Tools: Captures
 *
 * Quick capture and retrieval of thoughts, ideas, and references.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { query, queryOne } from "../db";
import { errorResult, type ToolContext } from "../guard";

export function registerCaptureTools(
  server: McpServer,
  ctx: ToolContext
) {
  // ─── List Captures ─────────────────────────────────────
  server.tool(
    "list_captures",
    "List recent captures (quick thoughts, ideas, references) with optional type filtering.",
    {
      capture_type: z
        .enum(["thought", "idea", "followup", "task", "quote", "reference", "link"])
        .optional()
        .describe("Filter by capture type"),
      processed: z
        .boolean()
        .optional()
        .describe("Filter by processed status"),
      limit: z.number().min(1).max(100).default(25).describe("Max results"),
    },
    async (params) => {
      const guard = ctx.guard("captures:read");
      if (!guard.ok) return errorResult(guard);
      const userId = guard.userId;
      const conditions: string[] = ["c.user_id = ?"];
      const args: (string | number)[] = [userId];

      if (params.capture_type) {
        conditions.push("c.capture_type = ?");
        args.push(params.capture_type);
      }
      if (params.processed !== undefined) {
        conditions.push("c.processed = ?");
        args.push(params.processed ? 1 : 0);
      }

      args.push(params.limit);

      const captures = await query<Record<string, unknown>>(
        `SELECT c.*
         FROM captures c
         WHERE ${conditions.join(" AND ")}
         ORDER BY c.captured_at DESC
         LIMIT ?`,
        args
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { count: captures.length, captures },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // ─── Create Capture ────────────────────────────────────
  server.tool(
    "create_capture",
    "Quickly capture a thought, idea, reference, or follow-up item.",
    {
      content: z.string().min(1).describe("Capture content"),
      capture_type: z
        .enum(["thought", "idea", "followup", "task", "quote", "reference", "link"])
        .default("thought")
        .describe("Type of capture"),
      tags: z
        .array(z.string())
        .optional()
        .describe("Tags for the capture"),
      linked_notes: z
        .array(z.string())
        .optional()
        .describe("Note IDs to link"),
      linked_projects: z
        .array(z.string())
        .optional()
        .describe("Project IDs to link"),
    },
    async (params) => {
      const guard = ctx.guard("captures:write");
      if (!guard.ok) return errorResult(guard);
      const userId = guard.userId;

      const result = await queryOne<{ id: string }>(
        `INSERT INTO captures (user_id, content, capture_type, tags, linked_notes, linked_projects)
         VALUES (?, ?, ?, ?, ?, ?)
         RETURNING id`,
        [
          userId,
          params.content,
          params.capture_type,
          JSON.stringify(params.tags || []),
          JSON.stringify(params.linked_notes || []),
          JSON.stringify(params.linked_projects || []),
        ]
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              capture_id: result?.id,
              message: `Captured ${params.capture_type}: "${params.content.substring(0, 80)}"`,
            }),
          },
        ],
      };
    }
  );
}
