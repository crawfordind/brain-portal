/**
 * Heartbeat Scheduler Engine
 *
 * The core execution engine that evaluates heartbeat tasks on each tick.
 * Each tick follows the cycle: READ → EVALUATE → DISPATCH → LOG
 *
 * Check types:
 * - db_query: Run a SQL query and evaluate the result count/values
 * - rule_eval: Evaluate a rule against current system state
 * - stale_check: Check if entities haven't been updated within a timeframe
 *
 * Action types:
 * - create_notification: Create an in-app notification (and optionally email)
 * - delegate_to_agent: Create an agent task for AI processing
 * - enqueue_processing: Add items to the processing queue
 */

import { db, queryAll, queryOne } from "@/lib/db/client";
import type { HeartbeatTask, HeartbeatLog } from "@/lib/db/schema";
import { createNotification } from "@/lib/notifications/engine";
import { executeSkill, initializeSkills } from "@/lib/skills";

// ─── Schedule Parsing ────────────────────────────────

const SCHEDULE_MAP: Record<string, number> = {
  "5m": 5 * 60 * 1000,
  "15m": 15 * 60 * 1000,
  "30m": 30 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "2h": 2 * 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "12h": 12 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
};

function parseScheduleMs(schedule: string): number {
  return SCHEDULE_MAP[schedule] || SCHEDULE_MAP["30m"];
}

function isDue(task: HeartbeatTask): boolean {
  if (!task.last_run_at) return true;
  const lastRun = new Date(task.last_run_at + "Z").getTime();
  const intervalMs = parseScheduleMs(task.schedule);
  return Date.now() - lastRun >= intervalMs;
}

// ─── Check Evaluators ────────────────────────────────

interface CheckResult {
  triggered: boolean;
  items: Record<string, unknown>[];
  summary: string;
}

/**
 * db_query check: Runs a read-only SQL query and evaluates condition against results.
 * check_source: JSON { "query": "SELECT ...", "args": [] }
 * condition: "count > 0" | "count >= 5" | "exists"
 */
async function evaluateDbQuery(
  task: HeartbeatTask
): Promise<CheckResult> {
  const config = JSON.parse(task.check_source) as {
    query: string;
    args?: (string | number)[];
  };

  // Safety: only allow SELECT queries
  const normalized = config.query.trim().toUpperCase();
  if (!normalized.startsWith("SELECT")) {
    throw new Error("Only SELECT queries are allowed in heartbeat checks");
  }

  const rows = await queryAll<Record<string, unknown>>(
    config.query,
    config.args || []
  );

  const triggered = evaluateCondition(task.condition, rows);

  return {
    triggered,
    items: rows,
    summary: `Query returned ${rows.length} row(s), condition "${task.condition}" = ${triggered}`,
  };
}

/**
 * rule_eval check: Evaluates a predefined rule against system state.
 * check_source: JSON { "rule": "overdue_tasks" | "stalled_projects" | "pending_captures" | "stuck_agents" | "missing_embeddings" | "stale_insights" }
 * condition: "count > 0" (applied to rule results)
 */
async function evaluateRule(
  task: HeartbeatTask
): Promise<CheckResult> {
  const config = JSON.parse(task.check_source) as { rule: string };
  let rows: Record<string, unknown>[] = [];

  switch (config.rule) {
    case "overdue_tasks":
      rows = await queryAll(
        `SELECT id, content, title, due_date, priority, user_id FROM tasks
         WHERE user_id = ? AND status IN ('pending', 'in_progress')
           AND due_date IS NOT NULL AND due_date < datetime('now')
         ORDER BY due_date ASC LIMIT 20`,
        [task.user_id]
      );
      break;

    case "stalled_projects":
      rows = await queryAll(
        `SELECT p.id, p.name, p.status, p.updated_at FROM projects p
         WHERE p.user_id = ? AND p.status = 'active'
           AND datetime(p.updated_at) < datetime('now', '-7 days')
         LIMIT 10`,
        [task.user_id]
      );
      break;

    case "pending_captures":
      rows = await queryAll(
        `SELECT id, content, capture_type FROM captures
         WHERE user_id = ? AND processed = 0
         ORDER BY created_at ASC LIMIT 20`,
        [task.user_id]
      );
      break;

    case "stuck_agents":
      rows = await queryAll(
        `SELECT id, title, status, updated_at FROM agent_tasks
         WHERE user_id = ? AND status = 'processing'
           AND datetime(updated_at) < datetime('now', '-15 minutes')
         LIMIT 10`,
        [task.user_id]
      );
      break;

    case "missing_embeddings":
      rows = await queryAll(
        `SELECT n.id, n.title FROM notes n
         LEFT JOIN embeddings e ON e.entity_type = 'note' AND e.entity_id = n.id
         WHERE n.user_id = ? AND e.id IS NULL AND n.content_plain IS NOT NULL
           AND length(n.content_plain) > 50
         LIMIT 20`,
        [task.user_id]
      );
      break;

    case "tasks_due_soon":
      rows = await queryAll(
        `SELECT id, content, title, due_date, priority FROM tasks
         WHERE user_id = ? AND status IN ('pending', 'in_progress')
           AND due_date IS NOT NULL
           AND due_date BETWEEN datetime('now') AND datetime('now', '+24 hours')
         ORDER BY due_date ASC LIMIT 10`,
        [task.user_id]
      );
      break;

    case "awaiting_review":
      rows = await queryAll(
        `SELECT id, title, assigned_agent, updated_at FROM agent_tasks
         WHERE user_id = ? AND status = 'awaiting_review'
         ORDER BY updated_at ASC LIMIT 10`,
        [task.user_id]
      );
      break;

    case "stale_insights": {
      // Dead-man's-switch for the insight generation job. The flagship
      // insight feature once silently died (0 insights generated for months)
      // and nothing noticed. Trigger an alert when the most recent insight is
      // older than a week AND there is enough fresh material that insights
      // *should* have been generated — so idle/empty accounts don't alert.
      const STALE_MS = 7 * 24 * 60 * 60 * 1000;
      const stats = await queryOne<{
        last_generated_at: string | null;
        recent_notes: number;
      }>(
        `SELECT
           (SELECT MAX(generated_at) FROM insights WHERE user_id = ?) AS last_generated_at,
           (SELECT COUNT(*) FROM notes
             WHERE user_id = ? AND is_archived = 0
               AND datetime(updated_at) >= datetime('now', '-7 days')) AS recent_notes`,
        [task.user_id, task.user_id]
      );

      const recentNotes = Number(stats?.recent_notes || 0);
      const lastGeneratedAt = stats?.last_generated_at || null;

      if (recentNotes >= 3) {
        const lastMs = lastGeneratedAt
          ? new Date(lastGeneratedAt + "Z").getTime()
          : null;
        const isStale = lastMs === null || Date.now() - lastMs >= STALE_MS;
        if (isStale) {
          const daysSince =
            lastMs === null
              ? null
              : Math.floor((Date.now() - lastMs) / (24 * 60 * 60 * 1000));
          rows = [
            {
              last_generated_at: lastGeneratedAt,
              days_since: daysSince,
              recent_notes: recentNotes,
            },
          ];
        }
      }
      break;
    }

    default:
      throw new Error(`Unknown rule: ${config.rule}`);
  }

  const triggered = evaluateCondition(task.condition, rows);
  return {
    triggered,
    items: rows,
    summary: `Rule "${config.rule}" found ${rows.length} item(s), condition "${task.condition}" = ${triggered}`,
  };
}

/**
 * stale_check: Check if any entities of a type haven't been updated within a timeframe.
 * check_source: JSON { "entity_type": "notes" | "tasks" | "captures", "stale_after": "7d" | "24h" }
 * condition: "count > 0"
 */
async function evaluateStaleCheck(
  task: HeartbeatTask
): Promise<CheckResult> {
  const config = JSON.parse(task.check_source) as {
    entity_type: string;
    stale_after: string;
  };

  // Parse stale_after into SQLite interval
  const match = config.stale_after.match(/^(\d+)(m|h|d)$/);
  if (!match) throw new Error(`Invalid stale_after format: ${config.stale_after}`);

  const [, amount, unit] = match;
  const sqliteUnit = unit === "d" ? "days" : unit === "h" ? "hours" : "minutes";
  const interval = `-${amount} ${sqliteUnit}`;

  const tableMap: Record<string, string> = {
    notes: "notes",
    tasks: "tasks",
    captures: "captures",
    projects: "projects",
  };
  const table = tableMap[config.entity_type];
  if (!table) throw new Error(`Unknown entity_type: ${config.entity_type}`);

  const rows = await queryAll<Record<string, unknown>>(
    `SELECT id, updated_at FROM ${table}
     WHERE user_id = ? AND datetime(updated_at) < datetime('now', ?)
     ORDER BY updated_at ASC LIMIT 20`,
    [task.user_id, interval]
  );

  const triggered = evaluateCondition(task.condition, rows);
  return {
    triggered,
    items: rows,
    summary: `Found ${rows.length} stale ${config.entity_type} (older than ${config.stale_after})`,
  };
}

// ─── Condition Evaluator ─────────────────────────────

function evaluateCondition(
  condition: string,
  rows: Record<string, unknown>[]
): boolean {
  const count = rows.length;

  // Simple condition parser: "count > 0", "count >= 5", "exists", "count == 0"
  if (condition === "exists") return count > 0;
  if (condition === "empty") return count === 0;

  const match = condition.match(/^count\s*(>|>=|<|<=|==|!=)\s*(\d+)$/);
  if (!match) return count > 0; // Default: trigger if any results

  const [, op, threshold] = match;
  const t = parseInt(threshold, 10);
  switch (op) {
    case ">": return count > t;
    case ">=": return count >= t;
    case "<": return count < t;
    case "<=": return count <= t;
    case "==": return count === t;
    case "!=": return count !== t;
    default: return count > 0;
  }
}

// ─── Action Dispatchers ──────────────────────────────

interface ActionParams {
  // create_notification
  title?: string;
  body?: string;
  priority?: "low" | "medium" | "high" | "urgent";
  type?: string;
  entity_type?: string;
  // delegate_to_agent
  agent_type?: string;
  task_type?: string;
  output_format?: string;
  // enqueue_processing
  operation?: string;
  tier?: string;
}

async function dispatchAction(
  task: HeartbeatTask,
  checkResult: CheckResult
): Promise<string> {
  const params = JSON.parse(task.action_params) as ActionParams;

  switch (task.action_type) {
    case "create_notification":
      return dispatchNotification(task, checkResult, params);
    case "delegate_to_agent":
      return dispatchAgentTask(task, checkResult, params);
    case "enqueue_processing":
      return dispatchProcessingQueue(task, checkResult, params);
    case "execute_skill":
      return dispatchSkill(task, checkResult, params);
    default:
      throw new Error(`Unknown action type: ${task.action_type}`);
  }
}

async function dispatchNotification(
  task: HeartbeatTask,
  checkResult: CheckResult,
  params: ActionParams
): Promise<string> {
  const itemCount = checkResult.items.length;
  const title = params.title || `Heartbeat: ${task.description}`;
  const body = params.body
    ? params.body.replace("{count}", String(itemCount))
    : `${task.description}: ${itemCount} item(s) found.`;

  const notifId = await createNotification({
    userId: task.user_id,
    type: (params.type as "system") || "system",
    title,
    body,
    priority: params.priority || "medium",
    entityType: params.entity_type || "heartbeat",
    entityId: task.id,
    metadata: {
      heartbeat_task: task.name,
      items_found: itemCount,
    },
  });

  return notifId
    ? `Notification created: ${notifId}`
    : "Notification deduplicated (already exists)";
}

async function dispatchAgentTask(
  task: HeartbeatTask,
  checkResult: CheckResult,
  params: ActionParams
): Promise<string> {
  // Build a description from the check results
  const itemSummary = checkResult.items
    .slice(0, 5)
    .map((item) => {
      const title = (item.title || item.content || item.name || item.id) as string;
      return `- ${title}`;
    })
    .join("\n");

  const description = `${task.description}\n\nItems found (${checkResult.items.length}):\n${itemSummary}`;

  // The keyword router that used to pick an agent here is gone. It existed to
  // spare the user a 17-way choice in the delegate dialog; that dialog is gone
  // too, and a heartbeat rule that wants a specialist can simply name one.
  // Unspecified work goes to the generalist.
  const resolvedAgent = params.agent_type && params.agent_type !== "auto" ? params.agent_type : "general";
  const routedBy = "heartbeat";

  await db.execute({
    sql: `INSERT INTO agent_tasks
          (user_id, title, description, task_type, assigned_agent, status, priority, output_format, source_type, source_id, routed_by)
          VALUES (?, ?, ?, ?, ?, 'queued', 'medium', ?, 'task', ?, ?)`,
    args: [
      task.user_id,
      `Heartbeat: ${task.name}`,
      description,
      params.task_type || resolvedAgent,
      resolvedAgent,
      params.output_format || "markdown",
      task.id,
      routedBy,
    ],
  });

  return `Agent task created for ${resolvedAgent} agent (${routedBy})`;
}

async function dispatchProcessingQueue(
  task: HeartbeatTask,
  checkResult: CheckResult,
  params: ActionParams
): Promise<string> {
  let enqueued = 0;
  const operation = params.operation || "generate_embedding";
  const tier = params.tier || "embedding";

  for (const item of checkResult.items.slice(0, 10)) {
    const entityId = item.id as string;
    if (!entityId) continue;

    // Check for duplicates
    const existing = await queryOne(
      `SELECT id FROM processing_queue
       WHERE entity_id = ? AND operation = ? AND status IN ('pending', 'processing')`,
      [entityId, operation]
    );
    if (existing) continue;

    await db.execute({
      sql: `INSERT INTO processing_queue
            (user_id, entity_type, entity_id, operation, tier, priority)
            VALUES (?, ?, ?, ?, ?, 0)`,
      args: [
        task.user_id,
        params.entity_type || "note",
        entityId,
        operation,
        tier,
      ],
    });
    enqueued++;
  }

  return `Enqueued ${enqueued} ${operation} job(s)`;
}

async function dispatchSkill(
  task: HeartbeatTask,
  checkResult: CheckResult,
  params: ActionParams & { skill_id?: string; skill_params?: Record<string, unknown> }
): Promise<string> {
  const skillId = params.skill_id;
  if (!skillId) {
    throw new Error("execute_skill action requires skill_id in action_params");
  }

  initializeSkills();

  // Merge check result context into skill params
  const skillParams = {
    ...params.skill_params,
    _heartbeat_items: checkResult.items.slice(0, 10),
    _heartbeat_count: checkResult.items.length,
    _heartbeat_summary: checkResult.summary,
  };

  const result = await executeSkill({
    skillId,
    userId: task.user_id,
    params: skillParams,
    triggerSource: "heartbeat",
    triggerId: task.id,
  });

  if (!result.success) {
    throw new Error(`Skill "${skillId}" failed: ${result.error}`);
  }

  return `Skill "${skillId}" executed successfully (${result.durationMs}ms)`;
}

// ─── Logging ─────────────────────────────────────────

async function logExecution(
  task: HeartbeatTask,
  status: HeartbeatLog["status"],
  checkResult: CheckResult | null,
  actionResult: string | null,
  durationMs: number,
  error?: string
): Promise<void> {
  await db.execute({
    sql: `INSERT INTO heartbeat_logs
          (heartbeat_task_id, user_id, status, items_evaluated, items_dispatched, action_taken, result_summary, error_message, duration_ms)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      task.id,
      task.user_id,
      status,
      checkResult?.items.length || 0,
      checkResult?.triggered ? 1 : 0,
      actionResult,
      checkResult?.summary || null,
      error || null,
      durationMs,
    ],
  });

  // Update task metadata
  await db.execute({
    sql: `UPDATE heartbeat_tasks
          SET last_run_at = datetime('now'),
              last_result = ?,
              run_count = run_count + 1,
              error_count = error_count + CASE WHEN ? = 'error' THEN 1 ELSE 0 END,
              updated_at = datetime('now')
          WHERE id = ?`,
    args: [checkResult?.summary || error || "ok", status, task.id],
  });
}

// ─── Main Tick Execution ─────────────────────────────

export interface TickResult {
  tasksEvaluated: number;
  tasksTriggered: number;
  tasksSkipped: number;
  errors: string[];
  duration_ms: number;
}

/**
 * Execute a single heartbeat tick for all users.
 * Called by the cron endpoint.
 */
export async function executeHeartbeatTick(): Promise<TickResult> {
  const startTime = Date.now();
  const result: TickResult = {
    tasksEvaluated: 0,
    tasksTriggered: 0,
    tasksSkipped: 0,
    errors: [],
    duration_ms: 0,
  };

  // Get all enabled heartbeat tasks
  const tasks = await queryAll<HeartbeatTask>(
    "SELECT * FROM heartbeat_tasks WHERE enabled = 1"
  );

  for (const task of tasks) {
    // Check if this task is due
    if (!isDue(task)) {
      result.tasksSkipped++;
      continue;
    }

    const taskStart = Date.now();
    result.tasksEvaluated++;

    try {
      // EVALUATE: Run the check
      let checkResult: CheckResult;
      switch (task.check_type) {
        case "db_query":
          checkResult = await evaluateDbQuery(task);
          break;
        case "rule_eval":
          checkResult = await evaluateRule(task);
          break;
        case "stale_check":
          checkResult = await evaluateStaleCheck(task);
          break;
        default:
          throw new Error(`Unknown check_type: ${task.check_type}`);
      }

      if (checkResult.triggered) {
        // DISPATCH: Execute the action
        const actionResult = await dispatchAction(task, checkResult);
        result.tasksTriggered++;

        // LOG: Record the execution
        await logExecution(
          task,
          "triggered",
          checkResult,
          actionResult,
          Date.now() - taskStart
        );
      } else {
        // SILENCE: Log OK and move on
        await logExecution(
          task,
          "ok",
          checkResult,
          null,
          Date.now() - taskStart
        );
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      result.errors.push(`${task.name}: ${msg}`);
      console.error(`[Heartbeat] Error in task "${task.name}":`, msg);

      await logExecution(task, "error", null, null, Date.now() - taskStart, msg);
    }
  }

  result.duration_ms = Date.now() - startTime;
  return result;
}

/**
 * Get heartbeat tasks for a specific user.
 */
export async function getHeartbeatTasks(userId: string): Promise<HeartbeatTask[]> {
  return queryAll<HeartbeatTask>(
    "SELECT * FROM heartbeat_tasks WHERE user_id = ? ORDER BY created_at DESC",
    [userId]
  );
}

/**
 * Get recent heartbeat logs for a user or specific task.
 */
export async function getHeartbeatLogs(
  userId: string,
  taskId?: string,
  limit = 50
): Promise<HeartbeatLog[]> {
  if (taskId) {
    return queryAll<HeartbeatLog>(
      `SELECT * FROM heartbeat_logs
       WHERE user_id = ? AND heartbeat_task_id = ?
       ORDER BY created_at DESC LIMIT ?`,
      [userId, taskId, limit]
    );
  }
  return queryAll<HeartbeatLog>(
    "SELECT * FROM heartbeat_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
    [userId, limit]
  );
}

/**
 * Cleanup old heartbeat logs (keep last N days).
 */
export async function cleanupHeartbeatLogs(daysOld = 30): Promise<number> {
  const result = await db.execute({
    sql: `DELETE FROM heartbeat_logs
          WHERE created_at < datetime('now', '-' || ? || ' days')`,
    args: [daysOld],
  });
  return result.rowsAffected;
}
