/**
 * Default Heartbeat Tasks
 *
 * These are the built-in system heartbeat tasks that get installed
 * for each user. They cover the most common proactive monitoring needs.
 */

export interface DefaultHeartbeatTask {
  name: string;
  description: string;
  check_type: "db_query" | "rule_eval" | "stale_check";
  check_source: Record<string, unknown>;
  condition: string;
  action_type: "create_notification" | "delegate_to_agent" | "enqueue_processing" | "execute_skill";
  action_params: Record<string, unknown>;
  schedule: string;
  owner: "system";
}

export const DEFAULT_HEARTBEAT_TASKS: DefaultHeartbeatTask[] = [
  {
    name: "overdue_task_alert",
    description: "Alert when tasks are past their due date",
    check_type: "rule_eval",
    check_source: { rule: "overdue_tasks" },
    condition: "count > 0",
    action_type: "create_notification",
    action_params: {
      title: "Overdue Tasks",
      body: "You have {count} overdue task(s) that need attention.",
      priority: "high",
      type: "task_overdue",
    },
    schedule: "1h",
    owner: "system",
  },
  {
    name: "tasks_due_soon_alert",
    description: "Alert when tasks are due within the next 24 hours",
    check_type: "rule_eval",
    check_source: { rule: "tasks_due_soon" },
    condition: "count > 0",
    action_type: "create_notification",
    action_params: {
      title: "Tasks Due Soon",
      body: "You have {count} task(s) due in the next 24 hours.",
      priority: "medium",
      type: "task_due_soon",
    },
    schedule: "6h",
    owner: "system",
  },
  {
    name: "stalled_project_detection",
    description: "Detect projects with no activity in 7+ days",
    check_type: "rule_eval",
    check_source: { rule: "stalled_projects" },
    condition: "count > 0",
    action_type: "create_notification",
    action_params: {
      title: "Stalled Projects",
      body: "{count} project(s) have had no activity in over a week.",
      priority: "medium",
      type: "project_stalled",
    },
    schedule: "24h",
    owner: "system",
  },
  {
    name: "unprocessed_captures",
    description: "Auto-triage captures when they pile up unprocessed",
    check_type: "rule_eval",
    check_source: { rule: "pending_captures" },
    condition: "count >= 5",
    action_type: "execute_skill",
    action_params: {
      skill_id: "auto_triage_captures",
      skill_params: {
        max_items: 10,
        auto_delegate: false,
      },
    },
    schedule: "12h",
    owner: "system",
  },
  {
    name: "embedding_freshness",
    description: "Auto-generate embeddings for notes missing them",
    check_type: "rule_eval",
    check_source: { rule: "missing_embeddings" },
    condition: "count > 0",
    action_type: "enqueue_processing",
    action_params: {
      operation: "generate_embedding",
      tier: "embedding",
      entity_type: "note",
    },
    schedule: "6h",
    owner: "system",
  },
  {
    name: "agent_review_reminder",
    description: "Remind about agent tasks awaiting review",
    check_type: "rule_eval",
    check_source: { rule: "awaiting_review" },
    condition: "count > 0",
    action_type: "create_notification",
    action_params: {
      title: "Agent Tasks Awaiting Review",
      body: "{count} AI agent task(s) are ready for your review.",
      priority: "medium",
      type: "agent_complete",
    },
    schedule: "2h",
    owner: "system",
  },
  {
    name: "weekly_insights_generation",
    description: "Generate AI insights from recent notes weekly",
    check_type: "stale_check",
    check_source: { entity_type: "notes", stale_after: "1d" },
    condition: "count >= 3",
    action_type: "execute_skill",
    action_params: {
      skill_id: "generate_insights",
      skill_params: {
        scope: "recent",
        days: 7,
      },
    },
    schedule: "24h",
    owner: "system",
  },
  {
    name: "insight_liveness_alert",
    description: "Alert when AI insight generation appears to have stalled",
    check_type: "rule_eval",
    check_source: { rule: "stale_insights" },
    condition: "count > 0",
    action_type: "create_notification",
    action_params: {
      title: "AI insights have stalled",
      body: "No new AI insights in over a week despite recent activity — the insight job may have stopped. Open Insights and tap Refresh, or check the heartbeat logs.",
      priority: "high",
      type: "system",
    },
    schedule: "24h",
    owner: "system",
  },
];
