import { queryAll, queryOne } from "@/lib/db/client";
import { Note, Project, Task } from "@/lib/db/schema";
import { CHAT_SYSTEM_PROMPTS } from "./prompts";
import { getCompiledGuardrails } from "@/lib/guardrails";
import { injectGuardrails } from "@/lib/guardrails/compiler";
import { findSimilarNotes } from "@/lib/ai/embeddings";
import { parseItemRef, loadChatItem, buildItemContextSummary } from "./item-context";

export interface ChatContext {
  systemPrompt: string;
  contextSummary: string;
}

export async function resolveChatContext(
  userId: string,
  contextType: string,
  contextId: string | null
): Promise<ChatContext> {
  const rawPrompt = CHAT_SYSTEM_PROMPTS[contextType] || CHAT_SYSTEM_PROMPTS.general;
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const basePrompt = `${rawPrompt}\n\nToday is ${dateStr}.`;

  let result: ChatContext;
  switch (contextType) {
    case "executive":
      result = await resolveExecutiveContext(userId, basePrompt);
      break;
    case "project":
      result = await resolveProjectContext(userId, contextId, basePrompt);
      break;
    case "note":
      result = await resolveNoteContext(userId, contextId, basePrompt);
      break;
    case "task":
      result = await resolveTaskContext(userId, basePrompt);
      break;
    case "item":
      result = await resolveItemContext(userId, contextId, basePrompt);
      break;
    default:
      result = await resolveGeneralContext(userId, basePrompt);
  }

  // Inject user guardrails into the system prompt
  try {
    const compiled = await getCompiledGuardrails(userId);
    if (compiled) {
      result.systemPrompt = injectGuardrails(result.systemPrompt, compiled);
    }
  } catch {
    // Non-fatal: guardrails table may not exist yet
  }

  return result;
}

async function resolveExecutiveContext(
  userId: string,
  basePrompt: string
): Promise<ChatContext> {
  try {
    const [projects, taskStats, urgentTasks, overdueTasks, recentCompletions, recentNotes] = await Promise.all([
      queryAll<{ name: string; status: string }>(
        "SELECT name, status FROM projects WHERE user_id = ? AND status = 'active' ORDER BY updated_at DESC LIMIT 5",
        [userId]
      ),
      queryOne<{ total: number; completed: number; pending: number; in_progress: number }>(
        `SELECT
          COUNT(*) as total,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
          SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress
        FROM tasks WHERE user_id = ?`,
        [userId]
      ),
      queryAll<{ title: string; content: string; due_date: string | null }>(
        `SELECT title, content, due_date FROM tasks
         WHERE user_id = ? AND status IN ('pending', 'in_progress')
           AND priority IN (3, 4)
         ORDER BY priority DESC, due_date ASC LIMIT 5`,
        [userId]
      ),
      queryAll<{ title: string; content: string; due_date: string }>(
        `SELECT title, content, due_date FROM tasks
         WHERE user_id = ? AND status IN ('pending', 'in_progress')
           AND due_date < date('now')
         ORDER BY due_date ASC LIMIT 5`,
        [userId]
      ),
      queryAll<{ title: string; content: string; updated_at: string }>(
        `SELECT title, content, updated_at FROM tasks
         WHERE user_id = ? AND status = 'completed'
           AND updated_at >= datetime('now', '-7 days')
         ORDER BY updated_at DESC LIMIT 5`,
        [userId]
      ),
      queryAll<{ title: string }>(
        "SELECT title FROM notes WHERE user_id = ? ORDER BY updated_at DESC LIMIT 5",
        [userId]
      ),
    ]);

    const parts: string[] = [
      `Active projects: ${projects.map((p) => p.name).join(", ") || "None"}`,
      `Tasks: ${taskStats?.pending || 0} pending, ${taskStats?.in_progress || 0} in progress, ${taskStats?.completed || 0} completed`,
    ];

    if (urgentTasks.length > 0) {
      parts.push(`\nHigh-priority tasks:\n${urgentTasks.map((t) => {
        const name = t.title || t.content;
        const due = t.due_date ? ` (due: ${t.due_date})` : "";
        return `- ${name}${due}`;
      }).join("\n")}`);
    }

    if (overdueTasks.length > 0) {
      parts.push(`\nOverdue tasks:\n${overdueTasks.map((t) => `- ${t.title || t.content} (was due: ${t.due_date})`).join("\n")}`);
    }

    if (recentCompletions.length > 0) {
      parts.push(`\nRecent wins (last 7 days):\n${recentCompletions.map((t) => `- ${t.title || t.content}`).join("\n")}`);
    }

    parts.push(`Recent notes: ${recentNotes.map((n) => n.title).join(", ") || "None"}`);

    const contextSummary = parts.join("\n");

    return {
      systemPrompt: `${basePrompt}\n\nCurrent workspace context:\n${contextSummary}`,
      contextSummary,
    };
  } catch {
    return { systemPrompt: basePrompt, contextSummary: "" };
  }
}

async function resolveProjectContext(
  userId: string,
  contextId: string | null,
  basePrompt: string
): Promise<ChatContext> {
  try {
    // No specific project — return a summary of all projects
    if (!contextId) {
      const projects = await queryAll<{ name: string; status: string; description: string | null }>(
        "SELECT name, status, description FROM projects WHERE user_id = ? AND status != 'archived' ORDER BY priority DESC, updated_at DESC LIMIT 15",
        [userId]
      );

      if (projects.length === 0) {
        return { systemPrompt: basePrompt, contextSummary: "No projects yet." };
      }

      const contextSummary = `All projects:\n${projects
        .map((p) => `- ${p.name} [${p.status}]${p.description ? ` — ${p.description}` : ""}`)
        .join("\n")}`;

      return {
        systemPrompt: `${basePrompt}\n\nThe user is viewing their projects list.\n\n${contextSummary}`,
        contextSummary,
      };
    }

    // contextId could be a slug — resolve to project
    const project = await queryOne<Project>(
      "SELECT * FROM projects WHERE (id = ? OR slug = ?) AND user_id = ?",
      [contextId, contextId, userId]
    );

    if (!project) return { systemPrompt: basePrompt, contextSummary: "" };

    const [notes, tasks] = await Promise.all([
      queryAll<{ title: string; content_plain: string | null }>(
        "SELECT title, content_plain FROM notes WHERE project_id = ? AND user_id = ? ORDER BY updated_at DESC LIMIT 5",
        [project.id, userId]
      ),
      queryAll<{ content: string; title: string | null; status: string }>(
        "SELECT content, title, status FROM tasks WHERE project_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 10",
        [project.id, userId]
      ),
    ]);

    const contextParts = [
      `Project: ${project.name}`,
      project.description ? `Description: ${project.description}` : "",
      `Status: ${project.status}`,
      notes.length > 0
        ? `\nRecent notes:\n${notes.map((n) => `- ${n.title}`).join("\n")}`
        : "",
      tasks.length > 0
        ? `\nTasks:\n${tasks.map((t) => `- [${t.status}] ${t.title || t.content}`).join("\n")}`
        : "",
    ].filter(Boolean);

    const contextSummary = contextParts.join("\n");

    return {
      systemPrompt: `${basePrompt}\n\nProject context:\n${contextSummary}`,
      contextSummary,
    };
  } catch {
    return { systemPrompt: basePrompt, contextSummary: "" };
  }
}

async function resolveNoteContext(
  userId: string,
  contextId: string | null,
  basePrompt: string
): Promise<ChatContext> {
  if (!contextId) return { systemPrompt: basePrompt, contextSummary: "" };

  try {
    const note = await queryOne<Note>(
      "SELECT * FROM notes WHERE (id = ? OR slug = ?) AND user_id = ?",
      [contextId, contextId, userId]
    );

    if (!note) return { systemPrompt: basePrompt, contextSummary: "" };

    const plainContent = note.content_plain || note.content;
    const truncated =
      plainContent.length > 2000
        ? plainContent.slice(0, 2000) + "..."
        : plainContent;

    const parts = [`Note: ${note.title}\n\nContent:\n${truncated}`];

    // Fetch semantically related notes with content so AI can synthesize connections
    try {
      const related = await findSimilarNotes(userId, note.id, 0.65, 4);
      if (related.length > 0) {
        const relatedLines = related.map((r) => {
          const snippet = (r.content_plain || "").slice(0, 200).trim();
          const preview = snippet ? `\n  > ${snippet}${(r.content_plain || "").length > 200 ? "..." : ""}` : "";
          return `- ${r.title} (${Math.round(r.similarity * 100)}% similar)${preview}`;
        });
        parts.push(`\nRelated notes:\n${relatedLines.join("\n")}`);
      }
    } catch {
      // Non-fatal: embeddings may not be available
    }

    const contextSummary = parts.join("\n");

    return {
      systemPrompt: `${basePrompt}\n\nNote context:\n${contextSummary}`,
      contextSummary,
    };
  } catch {
    return { systemPrompt: basePrompt, contextSummary: "" };
  }
}

/**
 * One specific item is the subject of the conversation.
 *
 * Falls back to the general context when the item can't be loaded — a deleted
 * note or a stale conversation should still be answerable, not an error.
 */
async function resolveItemContext(
  userId: string,
  contextId: string | null,
  basePrompt: string
): Promise<ChatContext> {
  const ref = parseItemRef(contextId);
  if (!ref) return resolveGeneralContext(userId, basePrompt);

  try {
    const item = await loadChatItem(userId, ref);
    if (!item) return resolveGeneralContext(userId, basePrompt);

    const contextSummary = await buildItemContextSummary(userId, item);

    return {
      systemPrompt: `${basePrompt}\n\nThe item under discussion:\n${contextSummary}`,
      contextSummary,
    };
  } catch {
    return { systemPrompt: basePrompt, contextSummary: "" };
  }
}

async function resolveTaskContext(
  userId: string,
  basePrompt: string
): Promise<ChatContext> {
  try {
    const tasks = await queryAll<{ content: string; title: string | null; status: string; priority: string }>(
      "SELECT content, title, status, priority FROM tasks WHERE user_id = ? AND status IN ('pending', 'in_progress') ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END LIMIT 15",
      [userId]
    );

    const contextSummary = tasks.length > 0
      ? `Active tasks:\n${tasks.map((t) => `- [${t.priority}] ${t.title || t.content} (${t.status})`).join("\n")}`
      : "No active tasks.";

    return {
      systemPrompt: `${basePrompt}\n\nTask context:\n${contextSummary}`,
      contextSummary,
    };
  } catch {
    return { systemPrompt: basePrompt, contextSummary: "" };
  }
}

async function resolveGeneralContext(
  userId: string,
  basePrompt: string
): Promise<ChatContext> {
  try {
    const [projects, tasks, captures] = await Promise.all([
      queryAll<{ name: string; status: string }>(
        "SELECT name, status FROM projects WHERE user_id = ? AND status = 'active' ORDER BY updated_at DESC LIMIT 5",
        [userId]
      ),
      queryAll<{ title: string | null; content: string; status: string; priority: string; due_date: string | null }>(
        `SELECT title, content, status, priority, due_date FROM tasks
         WHERE user_id = ? AND status IN ('pending', 'in_progress')
         ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END
         LIMIT 8`,
        [userId]
      ),
      queryAll<{ content: string; capture_type: string }>(
        `SELECT content, capture_type FROM captures
         WHERE user_id = ? AND captured_at >= datetime('now', '-2 days')
         ORDER BY captured_at DESC LIMIT 5`,
        [userId]
      ),
    ]);

    const parts: string[] = [];

    if (projects.length > 0) {
      parts.push(`Active projects: ${projects.map((p) => p.name).join(", ")}`);
    }

    if (tasks.length > 0) {
      parts.push(`Active tasks:\n${tasks.map((t) => {
        const name = t.title || t.content;
        const due = t.due_date ? ` (due: ${t.due_date})` : "";
        return `- [${t.priority}] ${name}${due}`;
      }).join("\n")}`);
    }

    if (captures.length > 0) {
      parts.push(`Recent thoughts:\n${captures.map((c) => `- [${c.capture_type}] ${c.content.slice(0, 120)}`).join("\n")}`);
    }

    const contextSummary = parts.join("\n\n");

    if (!contextSummary) {
      return { systemPrompt: basePrompt, contextSummary: "" };
    }

    return {
      systemPrompt: `${basePrompt}\n\nCurrent workspace:\n${contextSummary}`,
      contextSummary,
    };
  } catch {
    return { systemPrompt: basePrompt, contextSummary: "" };
  }
}
