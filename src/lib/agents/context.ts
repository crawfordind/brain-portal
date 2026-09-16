/**
 * Context Engine for Agent Tasks
 * Gathers relevant context before agent execution
 */

import { queryAll, queryOne } from "@/lib/db/client";
import { Note, Task, AgentTask } from "@/lib/db/schema";
import { findSimilarToText } from "@/lib/ai/embeddings";

export interface TaskContext {
  // Explicitly attached by user
  attachedNotes: Array<{
    id: string;
    title: string;
    content: string;
  }>;
  attachedUrls: string[];

  // Auto-retrieved via embeddings (if available)
  relevantNotes: Array<{
    id: string;
    title: string;
    content: string;
    similarity: number;
  }>;

  // Active tasks — what the user is currently working on
  activeTasks: Array<{
    title: string;
    status: string;
    priority: number;
    dueDate?: string;
    project?: string;
  }>;

  // Recently completed tasks — momentum and done-work awareness
  recentCompletions: Array<{
    title: string;
    completedAt: string;
    project?: string;
  }>;

  // Recent captures — the user's latest raw thinking
  recentCaptures: Array<{
    content: string;
    type: string;
    capturedAt: string;
  }>;

  // Project context (if task is part of a project)
  projectContext?: {
    name: string;
    description: string;
  };

  // User context
  userPreferences?: Record<string, unknown>;

  // Set when embedding lookup or other context sources failed silently
  contextDegraded?: boolean;
}

/**
 * Build context for an agent task
 */
export async function buildTaskContext(
  userId: string,
  taskDescription: string,
  contextNoteIds: string[],
  contextUrls: string[],
  projectId?: string | null,
  sourceEntityId?: string | null
): Promise<TaskContext> {
  const context: TaskContext = {
    attachedNotes: [],
    attachedUrls: contextUrls,
    relevantNotes: [],
    activeTasks: [],
    recentCompletions: [],
    recentCaptures: [],
  };

  // Fetch explicitly attached notes
  if (contextNoteIds.length > 0) {
    const placeholders = contextNoteIds.map(() => "?").join(",");
    const notes = await queryAll<Note>(
      `SELECT id, title, content FROM notes WHERE id IN (${placeholders}) AND user_id = ?`,
      [...contextNoteIds, userId]
    );

    context.attachedNotes = notes.map((n) => ({
      id: n.id,
      title: n.title,
      content: n.content,
    }));
  }

  // Find relevant notes via embeddings — semantic search against the task
  // description text (top 3 above similarity 0.7). Previously this called
  // findSimilarNotes(userId, taskDescription, …) which expects a noteId, not
  // free text, so every lookup silently returned no matches.
  try {
    const similarNotes = await findSimilarToText(userId, taskDescription, 0.7, 3);
    const excludeIds = new Set([...contextNoteIds, ...(sourceEntityId ? [sourceEntityId] : [])]);
    context.relevantNotes = similarNotes
      .filter((n) => !excludeIds.has(n.id))
      .map((n) => ({
        id: n.id,
        title: n.title,
        content: n.content_plain || "",
        similarity: n.similarity,
      }));
  } catch {
    context.contextDegraded = true;
  }

  // Fetch project context if a project is associated
  if (projectId) {
    try {
      const project = await queryOne<{ name: string; description: string }>(
        "SELECT name, description FROM projects WHERE id = ?",
        [projectId]
      );
      if (project) {
        context.projectContext = {
          name: project.name,
          description: project.description || "",
        };
      }
    } catch {
      context.contextDegraded = true;
    }
  }

  // Fetch user preferences
  try {
    const user = await queryOne<{ preferences: string }>(
      "SELECT preferences FROM users WHERE id = ?",
      [userId]
    );
    if (user?.preferences) {
      context.userPreferences = JSON.parse(user.preferences);
    }
  } catch {
    context.contextDegraded = true;
  }

  // Fetch active tasks for situational awareness (what is the user working on?)
  try {
    const tasks = await queryAll<{
      title: string;
      content: string;
      status: string;
      priority: number;
      due_date: string | null;
      project_name: string | null;
    }>(
      `SELECT t.title, t.content, t.status, t.priority, t.due_date, p.name as project_name
       FROM tasks t
       LEFT JOIN projects p ON t.project_id = p.id
       WHERE t.user_id = ? AND t.status IN ('pending', 'in_progress')
       ORDER BY t.priority DESC, t.due_date ASC
       LIMIT 10`,
      [userId]
    );
    context.activeTasks = tasks.map((t) => ({
      title: t.title || t.content,
      status: t.status,
      priority: t.priority,
      dueDate: t.due_date || undefined,
      project: t.project_name || undefined,
    }));
  } catch {
    // Non-fatal
  }

  // Fetch recently completed tasks (last 7 days) for momentum awareness
  try {
    const completions = await queryAll<{
      title: string;
      content: string;
      updated_at: string;
      project_name: string | null;
    }>(
      `SELECT t.title, t.content, t.updated_at, p.name as project_name
       FROM tasks t
       LEFT JOIN projects p ON t.project_id = p.id
       WHERE t.user_id = ? AND t.status = 'completed'
         AND t.updated_at >= datetime('now', '-7 days')
       ORDER BY t.updated_at DESC
       LIMIT 5`,
      [userId]
    );
    context.recentCompletions = completions.map((t) => ({
      title: t.title || t.content,
      completedAt: t.updated_at,
      project: t.project_name || undefined,
    }));
  } catch {
    // Non-fatal
  }

  // Fetch recent captures (last 3 days) for latest thinking
  try {
    const captures = await queryAll<{
      content: string;
      capture_type: string;
      captured_at: string;
    }>(
      `SELECT content, capture_type, captured_at FROM captures
       WHERE user_id = ? AND captured_at >= datetime('now', '-3 days')
       ORDER BY captured_at DESC LIMIT 5`,
      [userId]
    );
    context.recentCaptures = captures.map((c) => ({
      content: c.content,
      type: c.capture_type,
      capturedAt: c.captured_at,
    }));
  } catch {
    // Non-fatal
  }

  return context;
}

/**
 * Build context for a delegated task
 */
export async function buildTaskContextFromTask(
  userId: string,
  taskId: string
): Promise<TaskContext> {
  // Get the task
  const task = await queryOne<Task>(
    "SELECT * FROM tasks WHERE id = ? AND user_id = ?",
    [taskId, userId]
  );

  if (!task) {
    throw new Error(`Task ${taskId} not found`);
  }

  // Get agent task for full description
  const agentTask = task.agent_task_id
    ? await queryOne<AgentTask>(
        "SELECT * FROM agent_tasks WHERE id = ?",
        [task.agent_task_id]
      )
    : null;

  const taskDescription = agentTask?.description || task.description || task.title || task.content;
  let linkedNoteIds: string[] = [];
  try {
    linkedNoteIds = JSON.parse(task.linked_note_ids || '[]') as string[];
  } catch {
    // Corrupted JSON in DB — proceed without linked notes
  }

  // Build context using existing function (project_id now handled internally)
  return buildTaskContext(
    userId,
    taskDescription,
    linkedNoteIds,
    [],
    task.project_id
  );
}

// Per-note content caps keep a single big note from pushing the prompt over
// the model's context window. Explicitly attached notes get more room than
// auto-retrieved ones because the user chose them; auto-retrieved notes are
// weaker signal and shouldn't crowd out the actual task.
const ATTACHED_NOTE_CHAR_CAP = 4000;
const RELEVANT_NOTE_CHAR_CAP = 1500;

function truncateForPrompt(content: string, cap: number): string {
  if (!content) return "";
  if (content.length <= cap) return content;
  return `${content.slice(0, cap).trimEnd()}\n\n… [truncated — ${content.length - cap} more characters omitted]`;
}

const PROMPT_STRUCTURAL_TAGS = /(<\/?(?:role|content|context|output_requirements|original_content|previous_output|feedback|revision_instructions|source_entity)(?:\s[^>]*)?>)/gi;

function escapeForPrompt(text: string | unknown): string {
  const str = typeof text === "string" ? text : String(text ?? "");
  if (!str) return "";
  return str.replace(PROMPT_STRUCTURAL_TAGS, (match) =>
    match.replace(/</g, "＜").replace(/>/g, "＞")
  );
}

/**
 * Format context into a prompt-ready string
 */
export function formatContextForPrompt(context: TaskContext): string {
  const sections: string[] = [];

  // Project context (if exists)
  if (context.projectContext) {
    sections.push(`## Project Context\n**${escapeForPrompt(context.projectContext.name)}**\n${escapeForPrompt(context.projectContext.description)}\n`);
  }

  // Attached notes
  if (context.attachedNotes.length > 0) {
    sections.push("## Reference Notes\n");
    for (const note of context.attachedNotes) {
      sections.push(`### ${escapeForPrompt(note.title)}\n${truncateForPrompt(note.content, ATTACHED_NOTE_CHAR_CAP)}\n`);
    }
  }

  // Related notes (auto-retrieved)
  if (context.relevantNotes.length > 0) {
    sections.push("## Related Notes (auto-retrieved)\n");
    for (const note of context.relevantNotes) {
      sections.push(
        `### ${escapeForPrompt(note.title)} (similarity: ${(note.similarity * 100).toFixed(0)}%)\n${truncateForPrompt(note.content, RELEVANT_NOTE_CHAR_CAP)}\n`
      );
    }
  }

  // Active tasks (situational awareness)
  if (context.activeTasks.length > 0) {
    sections.push("## User's Active Tasks\n");
    for (const task of context.activeTasks) {
      const parts = [`- [${task.status}] ${escapeForPrompt(task.title)}`];
      if (task.project) parts.push(`(${escapeForPrompt(task.project)})`);
      if (task.dueDate) parts.push(`due: ${task.dueDate}`);
      sections.push(parts.join(" "));
    }
    sections.push("");
  }

  // Recently completed tasks (momentum)
  if (context.recentCompletions.length > 0) {
    sections.push("## Recently Completed\n");
    for (const task of context.recentCompletions) {
      const parts = [`- ${escapeForPrompt(task.title)}`];
      if (task.project) parts.push(`(${escapeForPrompt(task.project)})`);
      parts.push(`— ${task.completedAt.split("T")[0]}`);
      sections.push(parts.join(" "));
    }
    sections.push("");
  }

  // Recent captures (latest raw thinking)
  if (context.recentCaptures.length > 0) {
    sections.push("## Recent Thoughts & Captures\n");
    for (const capture of context.recentCaptures) {
      sections.push(`- [${capture.type}] ${escapeForPrompt(capture.content).slice(0, 200)}`);
    }
    sections.push("");
  }

  // Reference URLs
  if (context.attachedUrls.length > 0) {
    sections.push("## Reference Links\n");
    sections.push(context.attachedUrls.map((url) => `- ${url}`).join("\n"));
  }

  // User preferences (role, domain, tone, etc.)
  if (context.userPreferences && Object.keys(context.userPreferences).length > 0) {
    const prefs = context.userPreferences;
    const prefLines: string[] = [];
    if (prefs.role) prefLines.push(`Role: ${escapeForPrompt(prefs.role)}`);
    if (prefs.domain) prefLines.push(`Domain: ${escapeForPrompt(prefs.domain)}`);
    if (prefs.tone) prefLines.push(`Preferred tone: ${escapeForPrompt(prefs.tone)}`);
    if (prefs.expertise_level) prefLines.push(`Expertise level: ${escapeForPrompt(prefs.expertise_level)}`);
    if (prefs.goals) prefLines.push(`Current goals: ${escapeForPrompt(prefs.goals)}`);
    if (prefLines.length > 0) {
      sections.push(`## User Context\n${prefLines.join("\n")}\n`);
    }
  }

  if (context.contextDegraded) {
    sections.push("## Note\nSome automatic context (embeddings, preferences, or project data) was unavailable. Proceed with the information provided above.\n");
  }

  return sections.join("\n");
}
