import { NextRequest, NextResponse } from "next/server";
import { db, mutate, queryAll, queryOne } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";
import { AgentTask } from "@/lib/db/schema";
import { executeAgentTask } from "@/lib/agents/executor";

// GET /api/agent-tasks - List user's agent tasks
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const status = searchParams.get("status");
  const countOnly = searchParams.get("countOnly") === "true";
  // Filters for "what background work exists against this entity?", which is
  // what the note page asks. This used to be GET /api/delegate; that endpoint
  // went with the delegation UI, but the question outlived it.
  const sourceType = searchParams.get("sourceType");
  const sourceId = searchParams.get("sourceId");

  // Fast path: return only the count without JOINs or subqueries
  if (countOnly) {
    let countSql = "SELECT COUNT(*) as count FROM agent_tasks WHERE user_id = ?";
    const countArgs: string[] = [user.id];
    if (status) {
      countSql += " AND status = ?";
      countArgs.push(status);
    }
    const result = await queryOne<{ count: number }>(countSql, countArgs);
    return NextResponse.json({ count: result?.count || 0 });
  }

  let query = `
    SELECT
      at.*,
      p.name as project_name,
      ac.display_name as agent_name,
      ac.icon as agent_icon,
      t.note_id as task_note_id,
      n.title as note_title,
      n.slug as note_slug,
      latest_out.summary as latest_summary
    FROM agent_tasks at
    LEFT JOIN projects p ON at.project_id = p.id
    LEFT JOIN agent_configs ac ON at.assigned_agent = ac.agent_type
    LEFT JOIN tasks t ON at.task_id = t.id
    LEFT JOIN notes n ON t.note_id = n.id
    LEFT JOIN agent_task_outputs latest_out
      ON latest_out.agent_task_id = at.id
      AND latest_out.version_number = at.current_version
    WHERE at.user_id = ?
  `;
  const args: string[] = [user.id];

  if (status) {
    query += " AND at.status = ?";
    args.push(status);
  }

  if (sourceType && sourceId) {
    query += " AND at.source_type = ? AND at.source_id = ?";
    args.push(sourceType, sourceId);
  }

  query += " ORDER BY at.created_at DESC LIMIT 100";

  const tasks = await queryAll<
    AgentTask & {
      project_name?: string;
      agent_name?: string;
      agent_icon?: string;
      task_note_id?: string;
      note_title?: string;
      note_slug?: string;
      latest_summary?: string | null;
    }
  >(query, args);

  return NextResponse.json({ tasks });
}

// POST /api/agent-tasks - Create new agent task
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const {
    title,
    description,
    taskType,
    assignedAgent,
    priority = "medium",
    outputFormat = "markdown",
    contextNoteIds = [],
    contextUrls = [],
    projectId = null,
    autoExecute = true,
  } = body;

  if (!title?.trim() || !description?.trim()) {
    return NextResponse.json(
      { error: "Title and description required" },
      { status: 400 }
    );
  }

  if (!assignedAgent) {
    return NextResponse.json(
      { error: "Agent must be assigned" },
      { status: 400 }
    );
  }

  // Validate agent config exists
  const agentConfig = await queryOne<{ agent_type: string }>(
    "SELECT agent_type FROM agent_configs WHERE agent_type = ? AND is_active = TRUE",
    [assignedAgent]
  );
  if (!agentConfig) {
    return NextResponse.json(
      { error: `Unknown or inactive agent type: ${assignedAgent}` },
      { status: 400 }
    );
  }

  // Create task — use RETURNING to avoid the race of SELECT ORDER BY created_at
  const task = await mutate<AgentTask>(
    `INSERT INTO agent_tasks
      (user_id, title, description, task_type, assigned_agent, priority, output_format, context_note_ids, context_urls, project_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *`,
    [
      user.id,
      title.trim(),
      description.trim(),
      taskType || assignedAgent,
      assignedAgent,
      priority,
      outputFormat,
      JSON.stringify(contextNoteIds),
      JSON.stringify(contextUrls),
      projectId,
    ]
  );

  if (!task) {
    return NextResponse.json(
      { error: "Failed to create task" },
      { status: 500 }
    );
  }

  // Auto-execute if requested
  if (autoExecute) {
    executeAgentTask(task.id).catch((error) => {
      console.error("Error executing agent task:", error);
    });
  }

  return NextResponse.json({ task }, { status: 201 });
}
