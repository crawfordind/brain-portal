/**
 * MCP Prompts
 *
 * Templated prompts for common brain-portal interactions.
 * These guide Claude on how to interact with brain-portal data.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { query } from "../db";
import { hasScope } from "../auth";
import { consumeRateLimit } from "../rate-limit";
import type { ToolContext } from "../guard";

export function registerPrompts(
  server: McpServer,
  ctx: ToolContext
) {
  /**
   * Prompts require the `prompts:read` scope and consume a rate-limit
   * token. On denial, we throw — the MCP SDK will propagate that as a
   * JSON-RPC error to the client, which is the correct behavior for
   * prompt retrieval (no structured error body in the prompt schema).
   */
  function checkPrompt(): { userId: string } {
    const user = ctx.getUser();
    if (!hasScope(user, "prompts:read")) {
      throw new Error(
        `Missing required scope "prompts:read". Key "${user.keyName}" has: ${user.scopes.join(", ") || "none"}.`
      );
    }
    const rl = consumeRateLimit(user);
    if (!rl.allowed) {
      throw new Error(
        `Rate limit exceeded (${rl.limit}/min). Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.`
      );
    }
    return { userId: user.userId };
  }
  // ─── Summarize Notes ───────────────────────────────────
  server.prompt(
    "summarize_notes",
    "Summarize recent notes from Brain Portal, highlighting key themes and actionable items.",
    {
      days: z
        .string()
        .default("7")
        .describe("Number of days to look back (default: 7)"),
      project_id: z
        .string()
        .optional()
        .describe("Limit to a specific project"),
    },
    async (params) => {
      const { userId } = checkPrompt();
      const days = parseInt(params.days || "7", 10);

      let notesQuery = `
        SELECT n.title, n.content_plain, n.note_type, n.updated_at,
               p.name as project_name
        FROM notes n
        LEFT JOIN projects p ON n.project_id = p.id
        WHERE n.user_id = ? AND n.is_archived = FALSE
          AND n.updated_at > datetime('now', ? || ' days')`;
      const args: (string | number)[] = [userId, -days];

      if (params.project_id) {
        notesQuery += " AND n.project_id = ?";
        args.push(params.project_id);
      }

      notesQuery += " ORDER BY n.updated_at DESC LIMIT 30";

      const notes = await query<{
        title: string;
        content_plain: string | null;
        note_type: string;
        updated_at: string;
        project_name: string | null;
      }>(notesQuery, args);

      const notesText = notes
        .map(
          (n) =>
            `## ${n.title} (${n.note_type}${n.project_name ? `, ${n.project_name}` : ""})\nUpdated: ${n.updated_at}\n${(n.content_plain || "").substring(0, 800)}\n`
        )
        .join("\n---\n");

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `Here are my notes from the last ${days} days in Brain Portal. Please provide a concise summary highlighting:\n1. Key themes and topics\n2. Important decisions or conclusions\n3. Actionable items or follow-ups\n4. Connections between notes\n\n${notesText || "No notes found for this period."}`,
            },
          },
        ],
      };
    }
  );

  // ─── Weekly Review ─────────────────────────────────────
  server.prompt(
    "weekly_review",
    "Generate a comprehensive weekly review from Brain Portal data.",
    {},
    async () => {
      const { userId } = checkPrompt();

      const [notes, completedTasks, pendingTasks, captures, insights] =
        await Promise.all([
          query<{
            title: string;
            content_plain: string | null;
            note_type: string;
            project_name: string | null;
          }>(
            `SELECT n.title, n.content_plain, n.note_type, p.name as project_name
             FROM notes n
             LEFT JOIN projects p ON n.project_id = p.id
             WHERE n.user_id = ? AND n.updated_at > datetime('now', '-7 days')
               AND n.is_archived = FALSE
             ORDER BY n.updated_at DESC LIMIT 20`,
            [userId]
          ),
          query<{ content: string; project_name: string | null }>(
            `SELECT t.content, p.name as project_name
             FROM tasks t
             LEFT JOIN projects p ON t.project_id = p.id
             WHERE t.user_id = ? AND t.status = 'completed'
               AND t.completed_at > datetime('now', '-7 days')`,
            [userId]
          ),
          query<{ content: string; priority: string; due_date: string | null }>(
            `SELECT content, priority, due_date FROM tasks
             WHERE user_id = ? AND status IN ('pending', 'in_progress')
             ORDER BY priority DESC, due_date ASC NULLS LAST LIMIT 20`,
            [userId]
          ),
          query<{ content: string; capture_type: string }>(
            `SELECT content, capture_type FROM captures
             WHERE user_id = ? AND captured_at > datetime('now', '-7 days')
             ORDER BY captured_at DESC LIMIT 15`,
            [userId]
          ),
          query<{ title: string; content: string; insight_type: string }>(
            `SELECT title, content, insight_type FROM insights
             WHERE user_id = ? AND generated_at > datetime('now', '-7 days')
               AND is_dismissed = FALSE LIMIT 10`,
            [userId]
          ),
        ]);

      const context = `
## Notes Worked On This Week
${notes.map((n) => `- **${n.title}** (${n.note_type}${n.project_name ? `, ${n.project_name}` : ""}): ${(n.content_plain || "").substring(0, 200)}`).join("\n")}

## Tasks Completed (${completedTasks.length})
${completedTasks.map((t) => `- ${t.content}${t.project_name ? ` [${t.project_name}]` : ""}`).join("\n") || "None"}

## Pending Tasks (${pendingTasks.length})
${pendingTasks.map((t) => `- [${t.priority}] ${t.content}${t.due_date ? ` (due: ${t.due_date})` : ""}`).join("\n") || "None"}

## Captures This Week
${captures.map((c) => `- [${c.capture_type}] ${c.content}`).join("\n") || "None"}

## AI Insights
${insights.map((i) => `- **${i.title}** (${i.insight_type}): ${i.content.substring(0, 200)}`).join("\n") || "None"}
`.trim();

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `Please generate a weekly review based on my Brain Portal activity. Include:\n1. **Summary**: What was the main focus this week?\n2. **Wins**: Key accomplishments\n3. **Progress**: Notes and projects advanced\n4. **Blockers**: Any stalled items or overdue tasks\n5. **Next Week**: Priorities and recommendations\n\nHere's my data:\n\n${context}`,
            },
          },
        ],
      };
    }
  );

  // ─── Delegate Task ─────────────────────────────────────
  server.prompt(
    "plan_delegation",
    "Help plan how to delegate work to Brain Portal's AI agents.",
    {
      task_description: z
        .string()
        .describe("What needs to be done"),
    },
    async (params) => {
      checkPrompt();
      const agents = await query<{
        agent_type: string;
        display_name: string;
        description: string;
      }>(
        `SELECT agent_type, display_name, description
         FROM agent_configs WHERE is_active = TRUE ORDER BY display_name`
      );

      const agentList = agents
        .map(
          (a) => `- **${a.display_name}** (\`${a.agent_type}\`): ${a.description}`
        )
        .join("\n");

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `I want to delegate this work: "${params.task_description}"\n\nHere are the available AI agents in Brain Portal:\n${agentList}\n\nPlease recommend:\n1. Which agent(s) to use and why\n2. How to break down the work if it needs multiple agents\n3. What context/notes to include for best results\n4. Suggested instructions to give the agent\n\nAfter planning, I can use the \`delegate_to_agent\` tool to create the delegation.`,
            },
          },
        ],
      };
    }
  );

  // ─── Brain Dump ────────────────────────────────────────
  server.prompt(
    "brain_dump",
    "Process a brain dump - capture unstructured thoughts and organize them into notes, tasks, and captures.",
    {
      text: z.string().describe("Your unstructured brain dump text"),
    },
    async (params) => {
      checkPrompt();
      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `I'm doing a brain dump. Please help me organize the following thoughts into structured items for Brain Portal. For each item, tell me whether it should be:\n- A **note** (longer-form content worth preserving)\n- A **task** (actionable item with optional priority/due date)\n- A **capture** (quick thought, idea, or reference)\n\nAfter categorizing, use the appropriate tools (create_note, create_task, create_capture) to save them.\n\nHere's my brain dump:\n\n${params.text}`,
            },
          },
        ],
      };
    }
  );
}
