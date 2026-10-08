/**
 * Operations Control Center — reads and writes over existing tables.
 *
 * Everything here is a view over `tasks`, `projects`, `entities` and the
 * venture structure. The operational facts the columns cannot express live in
 * `tasks.metadata.ops` (see `fields.ts`). No table is created and no existing
 * row is rewritten except by an explicit call on that one row.
 *
 * Uses the shared `@/lib/db/client`, which is free of Next.js imports, so the
 * MCP tools call these same functions and an agent sees exactly what the UI
 * shows.
 */

import { db, query, queryOne } from "@/lib/db/client";
import type { Task } from "@/lib/db/schema";
import { spawnNextOccurrence } from "@/lib/tasks/complete";
import { safeTimeZone, todayInTimeZone } from "@/lib/email/when";
import {
  stampColumns,
  stampPlaceholders,
  stampValues,
  type ProvenanceStamp,
} from "@/lib/provenance/types";
import {
  applyOpsPatch,
  normalizeDate,
  readOps,
  resolveOps,
  type OpsPatch,
} from "./fields";
import { buildHomeSections, countItems } from "./classify";
import { taskHref, type OpsFields, type OpsItem, type OperationsOverview } from "./types";

/** Hard ceiling on rows a single view loads. Far above any real open-task count. */
const MAX_OPEN_TASKS = 2000;

interface TaskRow {
  id: string;
  title: string | null;
  content: string;
  status: OpsItem["status"];
  priority: OpsItem["priority"];
  due_date: string | null;
  project_id: string | null;
  project_name: string | null;
  project_slug: string | null;
  venture_id: string | null;
  venture_name: string | null;
  note_id: string | null;
  metadata: string | null;
  updated_at: string | null;
}

export class OpsError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** First line of the title, else of the content. */
export function itemTitle(row: Pick<TaskRow, "title" | "content">): string {
  const source = (row.title || row.content || "").trim();
  const first = source.split("\n")[0].trim();
  return first.length > 160 ? `${first.slice(0, 157)}…` : first || "Untitled task";
}

export function rowToItem(row: TaskRow): OpsItem {
  const ops = resolveOps(readOps(row.metadata));
  const due = row.due_date ? row.due_date.slice(0, 10) : null;
  return {
    id: String(row.id),
    title: itemTitle(row),
    status: row.status,
    priority: row.priority ?? "medium",
    dueDate: row.due_date,
    projectId: row.project_id,
    projectName: row.project_name,
    projectSlug: row.project_slug,
    ventureId: row.venture_id ?? null,
    ventureName: row.venture_name ?? null,
    noteId: row.note_id,
    updatedAt: row.updated_at,
    ops,
    nextDate: due ?? ops.expected_at ?? null,
    href: taskHref(String(row.id)),
  };
}

const TASK_COLUMNS = `t.id, t.title, t.content, t.status, t.priority, t.due_date,
  t.project_id, t.note_id, t.metadata, t.updated_at,
  p.name AS project_name, p.slug AS project_slug`;

/**
 * `projects.venture_id` exists only after the CRM Phase 0 migration. Try the
 * join that uses it, and fall back to one without on a database that has not
 * run it, rather than taking the page down.
 */
async function selectTasks(where: string, args: (string | number)[]): Promise<TaskRow[]> {
  try {
    return await query<TaskRow>(
      `SELECT ${TASK_COLUMNS}, p.venture_id AS venture_id, v.canonical_name AS venture_name
       FROM tasks t
       LEFT JOIN projects p ON p.id = t.project_id
       LEFT JOIN entities v ON v.id = p.venture_id
       WHERE ${where}
       LIMIT ${MAX_OPEN_TASKS}`,
      args
    );
  } catch {
    return query<TaskRow>(
      `SELECT ${TASK_COLUMNS}, NULL AS venture_id, NULL AS venture_name
       FROM tasks t
       LEFT JOIN projects p ON p.id = t.project_id
       WHERE ${where}
       LIMIT ${MAX_OPEN_TASKS}`,
      args
    );
  }
}

export async function getUserTimeZone(userId: string): Promise<string> {
  try {
    const row = await queryOne<{ timezone: string | null }>(
      "SELECT timezone FROM notification_preferences WHERE user_id = ?",
      [userId]
    );
    return safeTimeZone(row?.timezone);
  } catch {
    return "UTC";
  }
}

export async function getToday(userId: string, now: Date = new Date()) {
  const timeZone = await getUserTimeZone(userId);
  return { timeZone, today: todayInTimeZone(now, timeZone) };
}

/** Every open task, as an operational item. */
export async function loadOpenItems(userId: string): Promise<OpsItem[]> {
  const rows = await selectTasks(
    "t.user_id = ? AND t.status IN ('pending', 'in_progress')",
    [userId]
  );
  return rows.map(rowToItem);
}

export async function getOpsItem(userId: string, taskId: string): Promise<OpsItem | null> {
  const rows = await selectTasks("t.user_id = ? AND t.id = ?", [userId, taskId]);
  return rows[0] ? rowToItem(rows[0]) : null;
}

async function countIntake(userId: string): Promise<number> {
  try {
    const row = await queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM captures
       WHERE user_id = ? AND (processed = 0 OR processed IS NULL)`,
      [userId]
    );
    return Number(row?.n) || 0;
  } catch {
    return 0;
  }
}

export async function getOperationsOverview(
  userId: string,
  now: Date = new Date()
): Promise<Omit<OperationsOverview, "automationAlerts">> {
  const [{ today, timeZone }, items, intakeCount] = await Promise.all([
    getToday(userId, now),
    loadOpenItems(userId),
    countIntake(userId),
  ]);

  return {
    today,
    timeZone,
    sections: buildHomeSections(items, today),
    intakeCount,
    counts: countItems(items, today),
  };
}

// ─── Writes ──────────────────────────────────────────────────────────────

export interface OpsUpdateInput {
  ops?: OpsPatch;
  status?: OpsItem["status"];
  dueDate?: string | null;
  projectId?: string | null;
  title?: string;
}

const STATUSES = ["pending", "in_progress", "completed", "cancelled"] as const;

async function assertProject(userId: string, projectId: string): Promise<void> {
  const row = await queryOne<{ id: string }>(
    "SELECT id FROM projects WHERE id = ? AND user_id = ?",
    [projectId, userId]
  );
  if (!row) throw new OpsError("Project not found", 404);
}

async function assertEntity(userId: string, entityId: string): Promise<void> {
  try {
    const row = await queryOne<{ id: string }>(
      "SELECT id FROM entities WHERE id = ? AND user_id = ?",
      [entityId, userId]
    );
    if (row) return;
  } catch {
    // entities table absent: fall through to the same error
  }
  throw new OpsError("Contact not found", 404);
}

/**
 * A name typed as the counterparty ("Will") is linked to a contact only when
 * exactly one person or org carries that name or alias. Two Wills means no
 * link — guessing would put the wrong person's promise on someone's record.
 */
export async function matchContactByName(
  userId: string,
  name: string
): Promise<string | null> {
  const needle = name.trim().toLowerCase();
  if (!needle) return null;
  try {
    const rows = await query<{ id: string }>(
      `SELECT DISTINCT e.id FROM entities e
       LEFT JOIN entity_aliases a ON a.entity_id = e.id
       WHERE e.user_id = ? AND e.entity_type IN ('person', 'org')
         AND (lower(e.canonical_name) = ? OR lower(a.alias) = ?)
       LIMIT 2`,
      [userId, needle, needle]
    );
    return rows.length === 1 ? String(rows[0].id) : null;
  } catch {
    return null;
  }
}

/**
 * Update one task's operational state, and optionally the plain fields an
 * operational move usually travels with. Returns the previous `ops` so the
 * caller can offer an exact undo.
 */
export async function updateOpsItem(
  userId: string,
  taskId: string,
  input: OpsUpdateInput
): Promise<{
  item: OpsItem;
  previous: OpsFields;
  previousStatus: OpsItem["status"];
  previousDueDate: string | null;
}> {
  const existing = await queryOne<
    Pick<Task, "id" | "content" | "priority" | "project_id" | "note_id" | "tags" | "recurrence_end_date"> & {
      metadata: string | null;
      status: OpsItem["status"];
      due_date: string | null;
      recurrence_rule: string | null;
    }
  >(
    `SELECT id, content, priority, project_id, note_id, tags, metadata, status, due_date,
            recurrence_rule, recurrence_end_date
     FROM tasks WHERE id = ? AND user_id = ?`,
    [taskId, userId]
  );
  if (!existing) throw new OpsError("Task not found", 404);

  const sets: string[] = [];
  const args: (string | null)[] = [];
  let previous: OpsFields = readOps(existing.metadata);

  if (input.ops && Object.keys(input.ops).length > 0) {
    const patch = { ...input.ops };
    if (patch.counterparty_entity_id) {
      await assertEntity(userId, patch.counterparty_entity_id);
    } else if (patch.counterparty && patch.counterparty_entity_id === undefined) {
      patch.counterparty_entity_id = await matchContactByName(userId, patch.counterparty);
    }
    const applied = applyOpsPatch(existing.metadata, patch);
    previous = applied.previous;
    sets.push("metadata = ?");
    args.push(applied.metadata);
  }

  if (input.status !== undefined) {
    if (!(STATUSES as readonly string[]).includes(input.status)) {
      throw new OpsError("Invalid status");
    }
    sets.push("status = ?");
    args.push(input.status);
    if (input.status === "completed" && existing.status !== "completed") {
      sets.push("completed_at = CURRENT_TIMESTAMP");
    } else if (input.status !== "completed" && existing.status === "completed") {
      sets.push("completed_at = NULL");
    }
  }

  if (input.dueDate !== undefined) {
    // The same day is left alone, so re-saving a task whose due date carries
    // a time does not truncate it. A full timestamp (an undo restoring one)
    // is stored as given once its date part validates.
    const current = existing.due_date?.slice(0, 10) ?? null;
    if (input.dueDate === null) {
      if (existing.due_date !== null) {
        sets.push("due_date = ?");
        args.push(null);
      }
    } else if (input.dueDate !== existing.due_date) {
      const day = normalizeDate(input.dueDate);
      if (!day) throw new OpsError("dueDate must be YYYY-MM-DD");
      const value = input.dueDate.trim().length > 10 ? input.dueDate.trim().slice(0, 32) : day;
      if (value.length > 10 || day !== current) {
        sets.push("due_date = ?");
        args.push(value);
      }
    }
  }

  if (input.projectId !== undefined) {
    if (input.projectId) await assertProject(userId, input.projectId);
    sets.push("project_id = ?");
    args.push(input.projectId || null);
  }

  if (input.title !== undefined) {
    const title = input.title.trim();
    if (!title) throw new OpsError("title cannot be empty");
    sets.push("title = ?");
    args.push(title.slice(0, 500));
  }

  if (sets.length > 0) {
    sets.push("updated_at = CURRENT_TIMESTAMP");
    await db.execute({
      sql: `UPDATE tasks SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`,
      args: [...args, taskId, userId],
    });
  }

  // Completing a recurring task here must recur exactly as it does from the
  // task panel and the email button.
  if (input.status === "completed" && existing.status !== "completed" && existing.recurrence_rule) {
    await spawnNextOccurrence(userId, existing, existing.recurrence_rule, existing.recurrence_end_date ?? null);
  }

  const item = await getOpsItem(userId, taskId);
  if (!item) throw new OpsError("Task not found", 404);
  return {
    item,
    previous,
    previousStatus: existing.status,
    previousDueDate: existing.due_date ?? null,
  };
}

export interface OpsCreateInput {
  title: string;
  description?: string;
  projectId?: string | null;
  dueDate?: string | null;
  priority?: OpsItem["priority"];
  ops?: OpsPatch;
}

/**
 * Create a task that carries operational state. A plain `tasks` row — it shows
 * up in Tasks, the calendar, kanban and every existing integration unchanged.
 *
 * `stamp` is passed by MCP callers so the row records which key wrote it;
 * session callers leave it out and the columns stay NULL ("the user, typing"),
 * the same convention as every other session-cookie route.
 */
export async function createOpsItem(
  userId: string,
  input: OpsCreateInput,
  stamp?: ProvenanceStamp
): Promise<OpsItem> {
  const title = input.title?.trim();
  if (!title) throw new OpsError("title is required");
  if (input.projectId) await assertProject(userId, input.projectId);
  const due = input.dueDate ? normalizeDate(input.dueDate) : null;
  if (input.dueDate && !due) throw new OpsError("dueDate must be YYYY-MM-DD");

  const patch = { ...(input.ops ?? {}) };
  if (patch.counterparty_entity_id) {
    await assertEntity(userId, patch.counterparty_entity_id);
  } else if (patch.counterparty && patch.counterparty_entity_id === undefined) {
    patch.counterparty_entity_id = await matchContactByName(userId, patch.counterparty);
  }
  const { metadata } = applyOpsPatch("{}", patch);

  const priority = input.priority ?? "medium";
  const content = input.description?.trim() ? `${title}\n\n${input.description.trim()}` : title;

  const columns = ["user_id", "title", "content", "priority", "due_date", "project_id", "metadata"];
  const values: (string | null)[] = [userId, title.slice(0, 500), content, priority, due ?? null, input.projectId || null, metadata];
  if (stamp) {
    columns.push(stampColumns());
    values.push(...stampValues(stamp));
  }
  const placeholders = stamp
    ? `?, ?, ?, ?, ?, ?, ?, ${stampPlaceholders()}`
    : "?, ?, ?, ?, ?, ?, ?";

  const created = await queryOne<{ id: string }>(
    `INSERT INTO tasks (${columns.join(", ")}) VALUES (${placeholders}) RETURNING id`,
    values
  );
  if (!created) throw new OpsError("Could not create the item", 500);

  const item = await getOpsItem(userId, String(created.id));
  if (!item) throw new OpsError("Could not read back the item", 500);
  return item;
}
