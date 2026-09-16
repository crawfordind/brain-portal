/**
 * MCP Resources
 *
 * Exposes brain-portal data as readable MCP resources.
 * Resources provide data that can be referenced in conversations.
 */

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { query, queryOne } from "../db";
import { hasScope } from "../auth";
import { consumeRateLimit } from "../rate-limit";
import type { ToolContext } from "../guard";

export function registerResources(
  server: McpServer,
  ctx: ToolContext
) {
  /**
   * Resources all require the `resources:read` scope. A rate-limit token
   * is consumed per resource read — same as tool calls. Returns a
   * JSON-encoded error payload (visible to the client) if denied.
   */
  function checkResource(uri: string):
    | { ok: true; userId: string }
    | { ok: false; payload: { contents: Array<{ uri: string; mimeType: string; text: string }> } } {
    const user = ctx.getUser();
    if (!hasScope(user, "resources:read")) {
      return {
        ok: false,
        payload: {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify({
                error: "scope",
                message: `Missing required scope "resources:read".`,
                scope: "resources:read",
              }),
            },
          ],
        },
      };
    }
    const rl = consumeRateLimit(user);
    if (!rl.allowed) {
      return {
        ok: false,
        payload: {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify({
                error: "rate_limit",
                message: `Rate limit exceeded (${rl.limit}/min). Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
                retry_after_ms: rl.retryAfterMs,
              }),
            },
          ],
        },
      };
    }
    return { ok: true, userId: user.userId };
  }
  // ─── Notes List ────────────────────────────────────────
  server.resource(
    "notes-list",
    "brain://notes",
    {
      description:
        "List of all active notes with titles, types, projects, and last updated dates.",
      mimeType: "application/json",
    },
    async () => {
      const check = checkResource("brain://notes");
      if (!check.ok) return check.payload;
      const userId = check.userId;
      const notes = await query<Record<string, unknown>>(
        `SELECT n.id, n.title, n.slug, n.note_type, n.word_count,
                n.is_pinned, n.updated_at, p.name as project_name
         FROM notes n
         LEFT JOIN projects p ON n.project_id = p.id
         WHERE n.user_id = ? AND n.is_archived = FALSE
         ORDER BY n.updated_at DESC
         LIMIT 100`,
        [userId]
      );

      return {
        contents: [
          {
            uri: "brain://notes",
            mimeType: "application/json",
            text: JSON.stringify({ count: notes.length, notes }, null, 2),
          },
        ],
      };
    }
  );

  // ─── Individual Note (template) ────────────────────────
  server.resource(
    "note-detail",
    new ResourceTemplate("brain://notes/{noteId}", { list: undefined }),
    {
      description: "Full content of a specific note including tags.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const check = checkResource(uri.href);
      if (!check.ok) return check.payload;
      const userId = check.userId;
      const noteId = variables.noteId as string;

      const note = await queryOne<Record<string, unknown>>(
        `SELECT n.*, p.name as project_name
         FROM notes n
         LEFT JOIN projects p ON n.project_id = p.id
         WHERE n.id = ? AND n.user_id = ?`,
        [noteId, userId]
      );

      if (!note) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "text/plain",
              text: "Note not found.",
            },
          ],
        };
      }

      const tags = await query<{ name: string }>(
        `SELECT t.name FROM tags t
         JOIN note_tags nt ON t.id = nt.tag_id
         WHERE nt.note_id = ?`,
        [noteId]
      );

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(
              { note, tags: tags.map((t) => t.name) },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // ─── Projects List ─────────────────────────────────────
  server.resource(
    "projects-list",
    "brain://projects",
    {
      description: "All projects with status and task/note counts.",
      mimeType: "application/json",
    },
    async () => {
      const check = checkResource("brain://projects");
      if (!check.ok) return check.payload;
      const userId = check.userId;
      const projects = await query<Record<string, unknown>>(
        `SELECT p.*,
           (SELECT COUNT(*) FROM notes n WHERE n.project_id = p.id AND n.is_archived = FALSE) as note_count,
           (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status != 'cancelled') as task_count
         FROM projects p
         WHERE p.user_id = ?
         ORDER BY p.priority DESC, p.updated_at DESC`,
        [userId]
      );

      return {
        contents: [
          {
            uri: "brain://projects",
            mimeType: "application/json",
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

  // ─── Tasks List ────────────────────────────────────────
  server.resource(
    "tasks-list",
    "brain://tasks",
    {
      description: "All active (non-cancelled) tasks with priority and due dates.",
      mimeType: "application/json",
    },
    async () => {
      const check = checkResource("brain://tasks");
      if (!check.ok) return check.payload;
      const userId = check.userId;
      const tasks = await query<Record<string, unknown>>(
        `SELECT t.*, p.name as project_name
         FROM tasks t
         LEFT JOIN projects p ON t.project_id = p.id
         WHERE t.user_id = ? AND t.status != 'cancelled'
         ORDER BY
           CASE t.status WHEN 'in_progress' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
           CASE t.priority
             WHEN 'urgent' THEN 0 WHEN 'high' THEN 1
             WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END,
           t.due_date ASC NULLS LAST`,
        [userId]
      );

      return {
        contents: [
          {
            uri: "brain://tasks",
            mimeType: "application/json",
            text: JSON.stringify({ count: tasks.length, tasks }, null, 2),
          },
        ],
      };
    }
  );

  // ─── Daily Note ────────────────────────────────────────
  server.resource(
    "daily-note",
    "brain://daily",
    {
      description: "Today's daily note with mood, energy, focus, and reflection.",
      mimeType: "application/json",
    },
    async () => {
      const check = checkResource("brain://daily");
      if (!check.ok) return check.payload;
      const userId = check.userId;
      const today = new Date().toISOString().split("T")[0];

      const daily = await queryOne<Record<string, unknown>>(
        `SELECT dn.*, n.title, n.content, n.content_plain
         FROM daily_notes dn
         JOIN notes n ON dn.note_id = n.id
         WHERE dn.user_id = ? AND dn.date = ?`,
        [userId, today]
      );

      const captures = await query<Record<string, unknown>>(
        `SELECT * FROM captures
         WHERE user_id = ? AND date(captured_at) = ?
         ORDER BY captured_at DESC`,
        [userId, today]
      );

      return {
        contents: [
          {
            uri: "brain://daily",
            mimeType: "application/json",
            text: JSON.stringify(
              {
                date: today,
                daily_note: daily || null,
                captures: captures,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // ─── Available Agents ──────────────────────────────────
  server.resource(
    "agents-list",
    "brain://agents",
    {
      description:
        "List of all available AI agents with their specializations and descriptions.",
      mimeType: "application/json",
    },
    async () => {
      const check = checkResource("brain://agents");
      if (!check.ok) return check.payload;
      const agents = await query<Record<string, unknown>>(
        `SELECT agent_type, display_name, description, icon, is_active
         FROM agent_configs
         WHERE is_active = TRUE
         ORDER BY display_name`
      );

      return {
        contents: [
          {
            uri: "brain://agents",
            mimeType: "application/json",
            text: JSON.stringify(
              { count: agents.length, agents },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // ─── Insights ──────────────────────────────────────────
  server.resource(
    "insights-list",
    "brain://insights",
    {
      description: "Recent AI-generated insights (connections, patterns, gaps).",
      mimeType: "application/json",
    },
    async () => {
      const check = checkResource("brain://insights");
      if (!check.ok) return check.payload;
      const userId = check.userId;
      const insights = await query<Record<string, unknown>>(
        `SELECT * FROM insights
         WHERE user_id = ? AND is_dismissed = FALSE
         ORDER BY generated_at DESC
         LIMIT 30`,
        [userId]
      );

      return {
        contents: [
          {
            uri: "brain://insights",
            mimeType: "application/json",
            text: JSON.stringify(
              { count: insights.length, insights },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // ─── Dashboard Summary ─────────────────────────────────
  server.resource(
    "dashboard",
    "brain://dashboard",
    {
      description:
        "Dashboard summary: task stats, active projects, recent activity, upcoming deadlines.",
      mimeType: "application/json",
    },
    async () => {
      const check = checkResource("brain://dashboard");
      if (!check.ok) return check.payload;
      const userId = check.userId;

      const [taskStats, activeProjects, upcomingDeadlines, unreadNotifications] =
        await Promise.all([
          queryOne<Record<string, unknown>>(
            `SELECT
               (SELECT COUNT(*) FROM tasks WHERE user_id = ? AND status = 'pending') as pending,
               (SELECT COUNT(*) FROM tasks WHERE user_id = ? AND status = 'in_progress') as in_progress,
               (SELECT COUNT(*) FROM tasks WHERE user_id = ? AND status = 'completed'
                 AND completed_at > datetime('now', '-7 days')) as completed_this_week,
               (SELECT COUNT(*) FROM tasks WHERE user_id = ? AND due_date < date('now')
                 AND status NOT IN ('completed', 'cancelled')) as overdue`,
            [userId, userId, userId, userId]
          ),
          query<Record<string, unknown>>(
            `SELECT id, name, status, color
             FROM projects WHERE user_id = ? AND status = 'active'
             ORDER BY priority DESC LIMIT 10`,
            [userId]
          ),
          query<Record<string, unknown>>(
            `SELECT id, content, due_date, priority
             FROM tasks
             WHERE user_id = ? AND status IN ('pending', 'in_progress')
               AND due_date IS NOT NULL AND due_date <= date('now', '+7 days')
             ORDER BY due_date ASC LIMIT 10`,
            [userId]
          ),
          queryOne<{ count: number }>(
            `SELECT COUNT(*) as count FROM notifications
             WHERE user_id = ? AND is_read = FALSE`,
            [userId]
          ),
        ]);

      return {
        contents: [
          {
            uri: "brain://dashboard",
            mimeType: "application/json",
            text: JSON.stringify(
              {
                taskStats,
                activeProjects,
                upcomingDeadlines,
                unreadNotifications: unreadNotifications?.count || 0,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );
}
