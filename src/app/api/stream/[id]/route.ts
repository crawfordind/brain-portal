import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db, queryOne } from "@/lib/db/client";
import { safeParseJson, isErrorResponse } from "@/lib/api/validation";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const item = await queryOne<Record<string, unknown>>(
    `SELECT * FROM (
      SELECT
        c.id, 'capture' as source_table,
        CASE c.capture_type WHEN 'thought' THEN 'thought' WHEN 'idea' THEN 'thought' WHEN 'link' THEN 'reference' ELSE 'capture' END as type,
        CASE WHEN c.processed THEN 'archived' ELSE 'active' END as status,
        SUBSTR(c.content, 1, 60) as title, c.content, 'medium' as priority,
        NULL as project_id, NULL as project_name, NULL as project_color,
        c.tags, NULL as due_date, NULL as delegated_to, NULL as agent_status,
        c.created_at, c.created_at as updated_at
      FROM captures c WHERE c.user_id = ? AND c.id = ?
      UNION ALL
      SELECT
        t.id, 'task', 'task',
        CASE t.status WHEN 'completed' THEN 'completed' WHEN 'cancelled' THEN 'archived' ELSE 'active' END,
        COALESCE(t.title, t.content), COALESCE(t.description, t.content), t.priority,
        t.project_id, p.name, p.color,
        t.tags, t.due_date, t.delegated_to, at_sub.status,
        t.created_at, t.updated_at
      FROM tasks t LEFT JOIN projects p ON t.project_id = p.id LEFT JOIN agent_tasks at_sub ON t.agent_task_id = at_sub.id
      WHERE t.user_id = ? AND t.id = ?
      UNION ALL
      SELECT
        n.id, 'note',
        CASE n.note_type WHEN 'journal' THEN 'journal' WHEN 'monthly_journal' THEN 'journal' WHEN 'insight' THEN 'insight' ELSE 'note' END,
        CASE WHEN n.is_archived THEN 'archived' ELSE 'active' END,
        n.title, COALESCE(n.content_plain, SUBSTR(n.content, 1, 500)), 'low',
        n.project_id, p.name, p.color,
        COALESCE(n.auto_tags, '[]'), NULL, NULL, NULL,
        n.created_at, n.updated_at
      FROM notes n LEFT JOIN projects p ON n.project_id = p.id
      WHERE n.user_id = ? AND n.id = ?
      UNION ALL
      SELECT
        r.id, 'reminder', 'reminder',
        CASE r.status WHEN 'dismissed' THEN 'archived' ELSE 'active' END,
        r.title, COALESCE(r.content, r.title), r.priority,
        r.project_id, p.name, p.color,
        r.tags, r.remind_at, NULL, NULL,
        r.created_at, r.updated_at
      FROM reminders r LEFT JOIN projects p ON r.project_id = p.id
      WHERE r.user_id = ? AND r.id = ?
      UNION ALL
      SELECT
        i.id, 'insight', 'insight',
        CASE WHEN i.is_dismissed THEN 'archived' WHEN i.is_actioned THEN 'completed' ELSE 'active' END,
        i.title, i.content, 'low',
        NULL, NULL, NULL,
        '[]', NULL, NULL, NULL,
        i.generated_at, i.generated_at
      FROM insights i WHERE i.user_id = ? AND i.id = ?
      UNION ALL
      SELECT
        at2.id, 'agent_task', 'agent_output',
        CASE at2.status WHEN 'approved' THEN 'completed' WHEN 'rejected' THEN 'archived' WHEN 'failed' THEN 'archived' ELSE 'active' END,
        at2.title, at2.description, at2.priority,
        at2.project_id, p.name, p.color,
        '[]', NULL, at2.assigned_agent, at2.status,
        at2.created_at, at2.updated_at
      FROM agent_tasks at2 LEFT JOIN projects p ON at2.project_id = p.id
      WHERE at2.user_id = ? AND at2.id = ?
    ) LIMIT 1`,
    [user.id, id, user.id, id, user.id, id, user.id, id, user.id, id, user.id, id]
  );

  if (!item) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let tags: string[] = [];
  try {
    tags = typeof item.tags === "string" ? JSON.parse(item.tags as string || "[]") : [];
  } catch { /* ignore */ }

  return NextResponse.json({
    id: item.id,
    type: item.type,
    status: item.status,
    title: item.title,
    content: item.content,
    priority: item.priority,
    projectName: item.project_name,
    projectColor: item.project_color,
    tags,
    dueDate: item.due_date,
    delegatedTo: item.delegated_to,
    agentStatus: item.agent_status,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await safeParseJson(req);
  if (isErrorResponse(body)) return body;
  const { status } = body;

  if (status !== "archived") {
    return NextResponse.json({ error: "Unsupported operation" }, { status: 400 });
  }

  /*
   * A stream id is only unique within its own table and the feed does not say
   * which table the row came from, so every candidate is attempted. Ids are
   * uuids, so at most one can match.
   *
   * This used to be five sequential `mutate()` calls with a success flag set
   * from the return value — but `mutate` returns `rows[0] ?? null` and an
   * UPDATE without RETURNING has no rows, so the flag was permanently false
   * and the 404 branch (which additionally required *all five* statements to
   * throw) was unreachable. The endpoint reported success for every id,
   * including ids that do not exist. `rowsAffected` is the only honest signal
   * here, and one batch is one round trip instead of five.
   *
   * `agent_tasks` is deliberately absent: archiving agent output means
   * rejecting it, which is a review decision with its own endpoint and its own
   * side effects. An attempt to archive one now 404s instead of pretending.
   */
  const results = await db.batch([
    {
      sql: `UPDATE captures SET processed = TRUE
            WHERE id = ? AND user_id = ?`,
      args: [id, user.id],
    },
    {
      sql: `UPDATE tasks SET status = 'cancelled', updated_at = datetime('now')
            WHERE id = ? AND user_id = ?`,
      args: [id, user.id],
    },
    {
      sql: `UPDATE notes SET is_archived = TRUE, updated_at = datetime('now')
            WHERE id = ? AND user_id = ?`,
      args: [id, user.id],
    },
    {
      sql: `UPDATE reminders
            SET status = 'dismissed',
                dismissed_at = datetime('now'),
                updated_at = datetime('now')
            WHERE id = ? AND user_id = ?`,
      args: [id, user.id],
    },
    {
      sql: `UPDATE insights SET is_dismissed = TRUE
            WHERE id = ? AND user_id = ?`,
      args: [id, user.id],
    },
  ]);

  const archived = results.reduce(
    (total, result) => total + Number(result.rowsAffected ?? 0),
    0
  );

  if (archived === 0) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
