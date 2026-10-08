import { NextRequest, NextResponse } from "next/server";
import { queryAll, queryOne } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";
import { AgentTask } from "@/lib/db/schema";
import { createJackTask } from "@/lib/agents/jack/dispatcher";
import { publicJackStatus } from "@/lib/agents/jack/config";
import {
  AGENT_TYPES,
  INPUT_LIMITS,
  OUTPUT_FORMATS,
  PRIORITIES,
  cleanIdList,
  cleanUrls,
  isSourceType,
  ownedNoteIds,
  ownsRecord,
  resolveOwnedSource,
} from "@/lib/agents/jack/guard";
import { readJsonBody, rateLimited } from "@/lib/agents/jack/http";
import { isErrorResponse } from "@/lib/api/validation";

/**
 * "Needs you": work that is waiting on Daniel rather than on Jack. Output to
 * review, a decision Jack is paused on, and parked or unmappable work.
 */
const NEEDS_YOU_SQL = `(at.status = 'awaiting_review'
  OR at.jack_state IN ('awaiting_approval', 'awaiting_input', 'needs_dispatch', 'needs_review'))`;

// GET /api/agent-tasks - List user's agent tasks
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const status = searchParams.get("status");
  const countOnly = searchParams.get("countOnly") === "true";
  const needsYou = searchParams.get("needsYou") === "true";
  // Filters for "what background work exists against this entity?", which is
  // what the note page asks. This used to be GET /api/delegate; that endpoint
  // went with the delegation UI, but the question outlived it.
  const sourceType = searchParams.get("sourceType");
  const sourceId = searchParams.get("sourceId");

  // Fast path: return only the count without JOINs or subqueries
  if (countOnly) {
    let countSql = "SELECT COUNT(*) as count FROM agent_tasks at WHERE at.user_id = ?";
    const countArgs: string[] = [user.id];
    if (status) {
      countSql += " AND at.status = ?";
      countArgs.push(status);
    }
    if (needsYou) countSql += ` AND ${NEEDS_YOU_SQL}`;
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
    LEFT JOIN projects p ON at.project_id = p.id AND p.user_id = at.user_id
    LEFT JOIN agent_configs ac ON at.assigned_agent = ac.agent_type
    LEFT JOIN tasks t ON at.task_id = t.id AND t.user_id = at.user_id
    LEFT JOIN notes n ON t.note_id = n.id AND n.user_id = at.user_id
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
  if (needsYou) query += ` AND ${NEEDS_YOU_SQL}`;

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

  return NextResponse.json({ tasks, jack: publicJackStatus() });
}

// POST /api/agent-tasks - Delegate work to Jack
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const limited = rateLimited(user.id, "create");
  if (limited) return limited;

  const body = await readJsonBody(request);
  if (isErrorResponse(body)) return body;

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (!title || !description) {
    return NextResponse.json({ error: "Title and description required" }, { status: 400 });
  }
  if (title.length > INPUT_LIMITS.title || description.length > INPUT_LIMITS.description) {
    return NextResponse.json(
      { error: `Title is limited to ${INPUT_LIMITS.title} characters and the instruction to ${INPUT_LIMITS.description}.` },
      { status: 400 }
    );
  }

  // Jack is the only runtime. The agent type survives as a label for the job.
  const assignedAgent = body.assignedAgent ?? "general";
  const agentType = assignedAgent === "auto" ? "general" : assignedAgent;
  if (typeof agentType !== "string" || !(AGENT_TYPES as readonly string[]).includes(agentType)) {
    return NextResponse.json({ error: `Unknown agent type: ${String(agentType)}` }, { status: 400 });
  }
  const taskType = typeof body.taskType === "string" && (AGENT_TYPES as readonly string[]).includes(body.taskType)
    ? body.taskType
    : agentType;
  const priority = body.priority ?? "medium";
  if (!(PRIORITIES as readonly unknown[]).includes(priority)) {
    return NextResponse.json({ error: "Invalid priority" }, { status: 400 });
  }
  const outputFormat = body.outputFormat ?? "markdown";
  if (!(OUTPUT_FORMATS as readonly unknown[]).includes(outputFormat)) {
    return NextResponse.json({ error: "Invalid output format" }, { status: 400 });
  }

  const contextNoteIds = cleanIdList(body.contextNoteIds, INPUT_LIMITS.contextNotes);
  if (!contextNoteIds) {
    return NextResponse.json({ error: `Pin at most ${INPUT_LIMITS.contextNotes} notes` }, { status: 400 });
  }
  const contextUrls = cleanUrls(body.contextUrls);
  if (!contextUrls) {
    return NextResponse.json({ error: `At most ${INPUT_LIMITS.urls} http(s) URLs` }, { status: 400 });
  }

  // Every id the browser sends is checked against the signed-in user.
  const ownedNotes = await ownedNoteIds(user.id, contextNoteIds);
  if (ownedNotes.length !== contextNoteIds.length) {
    return NextResponse.json({ error: "One or more pinned notes were not found" }, { status: 404 });
  }

  let projectId: string | null = null;
  if (body.projectId !== undefined && body.projectId !== null) {
    if (typeof body.projectId !== "string" || !(await ownsRecord(user.id, "project", body.projectId))) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    projectId = body.projectId;
  }

  let sourceType = "task";
  let sourceId: string | null = null;
  if (body.sourceType !== undefined || body.sourceId !== undefined) {
    if (!isSourceType(body.sourceType) || typeof body.sourceId !== "string" || !body.sourceId) {
      return NextResponse.json({ error: "Invalid source" }, { status: 400 });
    }
    const resolved = await resolveOwnedSource(user.id, body.sourceType, body.sourceId);
    if (!resolved) {
      return NextResponse.json({ error: "Source not found" }, { status: 404 });
    }
    sourceType = resolved;
    sourceId = body.sourceId;
  }

  try {
    const { task, outcome } = await createJackTask({
      userId: user.id,
      title,
      description,
      taskType,
      assignedAgent: agentType,
      priority: priority as string,
      outputFormat: outputFormat as string,
      contextNoteIds: ownedNotes,
      contextUrls,
      projectId,
      sourceType,
      sourceId,
      linkTaskId: sourceType === "task" ? sourceId : null,
    });
    return NextResponse.json({ task, dispatch: outcome, jack: publicJackStatus() }, { status: 201 });
  } catch (error) {
    console.error("[API] POST /api/agent-tasks failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to create task" }, { status: 500 });
  }
}
