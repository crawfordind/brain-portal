/**
 * MCP Tools: AI
 *
 * Semantic search, insight generation, and agent delegation.
 * These tools leverage the AI capabilities of brain-portal.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { query, queryOne } from "../db";
import { errorResult, type ToolContext } from "../guard";

// We use OpenRouter directly here since this runs outside Next.js
import OpenAI from "openai";

function getOpenRouter() {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is required for AI tools.");
  }
  return new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY,
    defaultHeaders: {
      "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
      "X-Title": "Brain Portal MCP",
    },
  });
}

const EMBEDDING_MODEL = "openai/text-embedding-3-small";
const DEFAULT_MODEL = process.env.OPENROUTER_MODEL || "x-ai/grok-4.1-fast";

async function generateEmbedding(text: string): Promise<number[]> {
  const client = getOpenRouter();
  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text.substring(0, 8191),
  });
  return response.data[0].embedding;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function registerAITools(server: McpServer, ctx: ToolContext) {
  // ─── Semantic Search ───────────────────────────────────
  server.tool(
    "semantic_search",
    "Find notes semantically similar to a query using AI embeddings. More powerful than keyword search for finding conceptually related content.",
    {
      query: z.string().min(1).describe("Natural language search query"),
      threshold: z
        .number()
        .min(0)
        .max(1)
        .default(0.5)
        .describe("Minimum similarity score (0-1, default 0.5)"),
      limit: z
        .number()
        .min(1)
        .max(20)
        .default(10)
        .describe("Max results"),
    },
    async (params) => {
      const guard = ctx.guard("ai:search");
      if (!guard.ok) return errorResult(guard);
      const userId = guard.userId;

      const queryEmbedding = await generateEmbedding(params.query);

      const allEmbeddings = await query<{
        entity_id: string;
        embedding: string;
      }>(
        `SELECT entity_id, embedding FROM embeddings
         WHERE entity_type = 'note' AND user_id = ?`,
        [userId]
      );

      const similarities: { noteId: string; similarity: number }[] = [];
      for (const e of allEmbeddings) {
        const embedding = JSON.parse(e.embedding);
        const similarity = cosineSimilarity(queryEmbedding, embedding);
        if (similarity >= params.threshold) {
          similarities.push({ noteId: e.entity_id, similarity });
        }
      }

      similarities.sort((a, b) => b.similarity - a.similarity);
      const topResults = similarities.slice(0, params.limit);

      if (topResults.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                count: 0,
                results: [],
                message: "No similar notes found above the threshold.",
              }),
            },
          ],
        };
      }

      const noteIds = topResults.map((s) => s.noteId);
      const placeholders = noteIds.map(() => "?").join(",");
      const notes = await query<Record<string, unknown>>(
        `SELECT n.id, n.title, n.slug, n.summary, n.note_type, n.updated_at,
                p.name as project_name
         FROM notes n
         LEFT JOIN projects p ON n.project_id = p.id
         WHERE n.id IN (${placeholders})`,
        noteIds
      );

      const results = topResults.map((s) => {
        const note = notes.find(
          (n) => n.id === s.noteId
        );
        return { ...note, similarity: Math.round(s.similarity * 1000) / 1000 };
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { count: results.length, results },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // ─── Generate Insights ─────────────────────────────────
  server.tool(
    "generate_insights",
    "Generate AI-powered insights from recent notes and captures. Finds connections, patterns, gaps, and actionable suggestions.",
    {
      scope: z
        .enum(["recent", "project", "all"])
        .default("recent")
        .describe("Scope of analysis"),
      project_id: z
        .string()
        .optional()
        .describe("Project ID (required if scope is 'project')"),
      days: z
        .number()
        .min(1)
        .max(90)
        .default(7)
        .describe("Number of days to analyze (for 'recent' scope)"),
    },
    async (params) => {
      const guard = ctx.guard("ai:insights");
      if (!guard.ok) return errorResult(guard);
      const userId = guard.userId;
      const client = getOpenRouter();

      // Gather context
      let notesCondition = "n.user_id = ? AND n.is_archived = FALSE";
      const notesArgs: (string | number)[] = [userId];

      if (params.scope === "recent") {
        notesCondition += " AND n.updated_at > datetime('now', ? || ' days')";
        notesArgs.push(-params.days);
      } else if (params.scope === "project" && params.project_id) {
        notesCondition += " AND n.project_id = ?";
        notesArgs.push(params.project_id);
      }

      const recentNotes = await query<{
        id: string;
        title: string;
        content_plain: string;
        note_type: string;
      }>(
        `SELECT id, title, content_plain, note_type FROM notes n
         WHERE ${notesCondition}
         ORDER BY n.updated_at DESC LIMIT 20`,
        notesArgs
      );

      const captures = await query<{ content: string; capture_type: string }>(
        `SELECT content, capture_type FROM captures
         WHERE user_id = ? AND captured_at > datetime('now', '-7 days')
         ORDER BY captured_at DESC LIMIT 20`,
        [userId]
      );

      if (recentNotes.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                insights: [],
                message: "Not enough content to generate insights.",
              }),
            },
          ],
        };
      }

      const context = {
        recentNotes: recentNotes.map((n) => ({
          title: n.title,
          content: (n.content_plain || "").substring(0, 500),
          type: n.note_type,
        })),
        captures: captures.map((c) => ({
          content: c.content.substring(0, 200),
          type: c.capture_type,
        })),
      };

      const response = await client.chat.completions.create({
        model: DEFAULT_MODEL,
        messages: [
          {
            role: "system",
            content:
              "You are an insight generator for a personal knowledge management system. Analyze the user's notes and captures to find connections, patterns, gaps, and actionable suggestions. Respond with valid JSON only.",
          },
          {
            role: "user",
            content: `Analyze this content and generate insights:\n${JSON.stringify(context, null, 2)}\n\nRespond as JSON: { "insights": [{ "type": "connection|pattern|gap|action|question", "title": "...", "content": "...", "confidence": 0.0-1.0 }] }`,
          },
        ],
        max_tokens: 2048,
        temperature: 0.5,
      });

      const raw = response.choices[0]?.message?.content || "{}";
      let insights;
      try {
        const jsonMatch = raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
        insights = jsonMatch ? JSON.parse(jsonMatch[0]) : { insights: [] };
      } catch {
        insights = { insights: [], raw_response: raw };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(insights, null, 2),
          },
        ],
      };
    }
  );

  // ─── Delegate to Agent ─────────────────────────────────
  server.tool(
    "delegate_to_agent",
    "Queue background work for an AI agent. The output lands in the user's review queue rather than coming back here. Agent types: code, copy, research, marketing, analyst, general, ux, legal, finance, hr, product, sales, operations, security, data_eng, educator, strategy.",
    {
      title: z.string().min(1).describe("Task title for the agent"),
      description: z
        .string()
        .min(1)
        .describe("Detailed instructions for the agent"),
      agent_type: z
        .enum([
          "code", "copy", "research", "marketing", "analyst", "general",
          "ux", "legal", "finance", "hr", "product", "sales",
          "operations", "security", "data_eng", "educator", "strategy",
          "auto",
        ])
        .default("auto")
        .describe("Agent type. 'auto' runs the generalist — name a specialist if you want one."),
      priority: z
        .enum(["low", "medium", "high", "urgent"])
        .default("medium")
        .describe("Task priority"),
      context_note_ids: z
        .array(z.string())
        .optional()
        .describe("Note IDs to include as context"),
      source_type: z
        .enum(["task", "note", "capture", "reminder", "thought", "insight", "journal"])
        .default("task")
        .describe("Type of source entity"),
      source_id: z
        .string()
        .optional()
        .describe("ID of the source entity"),
    },
    async (params) => {
      const guard = ctx.guard("ai:delegate");
      if (!guard.ok) return errorResult(guard);
      const userId = guard.userId;

      // Keyword routing is gone: it existed to spare the user a 17-way choice
      // in a delegate dialog that no longer exists, and guessing a specialist
      // from keyword counts was never better than asking the caller to say.
      const agentType = params.agent_type === "auto" ? "general" : params.agent_type;
      const routedBy = "user";

      const result = await queryOne<{ id: string }>(
        `INSERT INTO agent_tasks
         (user_id, title, description, task_type, assigned_agent, priority,
          output_format, context_note_ids, context_urls, source_type, source_id, routed_by)
         VALUES (?, ?, ?, ?, ?, ?, 'markdown', ?, '[]', ?, ?, ?)
         RETURNING id`,
        [
          userId,
          params.title,
          params.description,
          agentType,
          agentType,
          params.priority,
          JSON.stringify(params.context_note_ids || []),
          params.source_type,
          params.source_id || null,
          routedBy,
        ]
      );

      // Trigger execution via the HTTP API if available
      const appUrl = process.env.NEXT_PUBLIC_APP_URL;
      if (result?.id && appUrl) {
        fetch(`${appUrl}/api/agent-tasks/${result.id}/execute`, {
          method: "POST",
          headers: { "X-Internal-Secret": process.env.INTERNAL_SECRET || "" },
        }).catch(() => {});
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              agent_task_id: result?.id,
              assigned_agent: agentType,
              routed_by: routedBy,
              message: `Task delegated to ${agentType} agent: "${params.title}"`,
              note: appUrl
                ? "The task has been queued for execution."
                : "The task is queued. Trigger execution via the web app or process-queue script.",
            }),
          },
        ],
      };
    }
  );

  // ─── Get Agent Task ────────────────────────────────────
  server.tool(
    "get_agent_task",
    "Check the status and output of a delegated agent task.",
    {
      agent_task_id: z.string().describe("Agent task ID"),
    },
    async (params) => {
      const guard = ctx.guard("ai:delegate");
      if (!guard.ok) return errorResult(guard);
      const userId = guard.userId;

      const task = await queryOne<Record<string, unknown>>(
        `SELECT at.*, ac.display_name as agent_name
         FROM agent_tasks at
         LEFT JOIN agent_configs ac ON at.assigned_agent = ac.agent_type
         WHERE at.id = ? AND at.user_id = ?`,
        [params.agent_task_id, userId]
      );

      if (!task) {
        return {
          content: [
            { type: "text" as const, text: "Agent task not found." },
          ],
          isError: true,
        };
      }

      // Get latest output if available
      const output = await queryOne<Record<string, unknown>>(
        `SELECT * FROM agent_task_outputs
         WHERE agent_task_id = ?
         ORDER BY version_number DESC LIMIT 1`,
        [params.agent_task_id]
      );

      // Get feedback history
      const feedback = await query<Record<string, unknown>>(
        `SELECT * FROM agent_task_feedback
         WHERE agent_task_id = ?
         ORDER BY created_at DESC`,
        [params.agent_task_id]
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { task, latestOutput: output, feedback },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // ─── List Agent Tasks ──────────────────────────────────
  server.tool(
    "list_agent_tasks",
    "List delegated agent tasks with optional status filtering.",
    {
      status: z
        .enum([
          "queued",
          "processing",
          "awaiting_review",
          "revision_requested",
          "approved",
          "rejected",
          "failed",
        ])
        .optional()
        .describe("Filter by status"),
      limit: z.number().min(1).max(50).default(20).describe("Max results"),
    },
    async (params) => {
      const guard = ctx.guard("ai:delegate");
      if (!guard.ok) return errorResult(guard);
      const userId = guard.userId;
      const conditions: string[] = ["at.user_id = ?"];
      const args: (string | number)[] = [userId];

      if (params.status) {
        conditions.push("at.status = ?");
        args.push(params.status);
      }

      args.push(params.limit);

      const tasks = await query<Record<string, unknown>>(
        `SELECT at.id, at.title, at.assigned_agent, at.status, at.priority,
                at.source_type, at.created_at, at.updated_at,
                ac.display_name as agent_name
         FROM agent_tasks at
         LEFT JOIN agent_configs ac ON at.assigned_agent = ac.agent_type
         WHERE ${conditions.join(" AND ")}
         ORDER BY at.created_at DESC
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
}
