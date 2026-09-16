import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { query } from "@/lib/db/client";

interface SummaryRow {
  total_tasks: number;
  completed_tasks: number;
  failed_tasks: number;
  total_tokens_input: number;
  total_tokens_output: number;
  total_processing_time_ms: number;
}

interface AgentBreakdownRow {
  assigned_agent: string;
  display_name: string;
  icon: string;
  task_count: number;
  completed_count: number;
  tokens_input: number;
  tokens_output: number;
  processing_time_ms: number;
}

interface DailyActivityRow {
  date: string;
  created_count: number;
  completed_count: number;
}

interface ModelUsageRow {
  model_used: string;
  tokens_input: number;
  tokens_output: number;
  invocation_count: number;
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "30d";

    // Build date filter
    let dateFilter = "";
    if (period !== "all") {
      const days = period === "7d" ? 7 : period === "90d" ? 90 : 30;
      dateFilter = `AND at.created_at >= datetime('now', '-${days} days')`;
    }

    // Run all queries in parallel
    const [summaryRows, agentBreakdown, dailyActivity, modelUsage] =
      await Promise.all([
        // Summary stats
        query<SummaryRow>(
          `SELECT
            COUNT(*) as total_tasks,
            SUM(CASE WHEN at.status = 'approved' THEN 1 ELSE 0 END) as completed_tasks,
            SUM(CASE WHEN at.status = 'failed' THEN 1 ELSE 0 END) as failed_tasks,
            COALESCE(SUM(ato.tokens_input), 0) as total_tokens_input,
            COALESCE(SUM(ato.tokens_output), 0) as total_tokens_output,
            COALESCE(SUM(ato.processing_time_ms), 0) as total_processing_time_ms
          FROM agent_tasks at
          LEFT JOIN agent_task_outputs ato ON ato.agent_task_id = at.id
          WHERE at.user_id = ? ${dateFilter}`,
          [user.id]
        ),

        // Per-agent breakdown
        query<AgentBreakdownRow>(
          `SELECT
            at.assigned_agent,
            COALESCE(ac.display_name, at.assigned_agent) as display_name,
            COALESCE(ac.icon, '🤖') as icon,
            COUNT(DISTINCT at.id) as task_count,
            SUM(CASE WHEN at.status = 'approved' THEN 1 ELSE 0 END) as completed_count,
            COALESCE(SUM(ato.tokens_input), 0) as tokens_input,
            COALESCE(SUM(ato.tokens_output), 0) as tokens_output,
            COALESCE(SUM(ato.processing_time_ms), 0) as processing_time_ms
          FROM agent_tasks at
          LEFT JOIN agent_configs ac ON at.assigned_agent = ac.agent_type
          LEFT JOIN agent_task_outputs ato ON ato.agent_task_id = at.id
          WHERE at.user_id = ? ${dateFilter}
          GROUP BY at.assigned_agent
          ORDER BY task_count DESC`,
          [user.id]
        ),

        // Daily activity (for chart)
        query<DailyActivityRow>(
          `SELECT
            DATE(at.created_at) as date,
            COUNT(*) as created_count,
            SUM(CASE WHEN at.status = 'approved' THEN 1 ELSE 0 END) as completed_count
          FROM agent_tasks at
          WHERE at.user_id = ? ${dateFilter}
          GROUP BY DATE(at.created_at)
          ORDER BY date ASC`,
          [user.id]
        ),

        // Model usage (for cost estimation)
        query<ModelUsageRow>(
          `SELECT
            ato.model_used,
            SUM(ato.tokens_input) as tokens_input,
            SUM(ato.tokens_output) as tokens_output,
            COUNT(*) as invocation_count
          FROM agent_task_outputs ato
          JOIN agent_tasks at ON ato.agent_task_id = at.id
          WHERE at.user_id = ? ${dateFilter}
          GROUP BY ato.model_used
          ORDER BY tokens_input DESC`,
          [user.id]
        ),
      ]);

    const summary = summaryRows[0] || {
      total_tasks: 0,
      completed_tasks: 0,
      failed_tasks: 0,
      total_tokens_input: 0,
      total_tokens_output: 0,
      total_processing_time_ms: 0,
    };

    return NextResponse.json({
      summary: {
        totalTasks: Number(summary.total_tasks),
        completedTasks: Number(summary.completed_tasks),
        failedTasks: Number(summary.failed_tasks),
        totalTokensInput: Number(summary.total_tokens_input),
        totalTokensOutput: Number(summary.total_tokens_output),
        totalProcessingTimeMs: Number(summary.total_processing_time_ms),
      },
      agentBreakdown: agentBreakdown.map((row) => ({
        agent: row.assigned_agent,
        displayName: row.display_name,
        icon: row.icon,
        taskCount: Number(row.task_count),
        completedCount: Number(row.completed_count),
        tokensInput: Number(row.tokens_input),
        tokensOutput: Number(row.tokens_output),
        processingTimeMs: Number(row.processing_time_ms),
      })),
      dailyActivity: dailyActivity.map((row) => ({
        date: row.date,
        created: Number(row.created_count),
        completed: Number(row.completed_count),
      })),
      modelUsage: modelUsage.map((row) => ({
        model: row.model_used,
        tokensInput: Number(row.tokens_input),
        tokensOutput: Number(row.tokens_output),
        invocations: Number(row.invocation_count),
      })),
    });
  } catch (error) {
    console.error("Failed to fetch agent stats:", error);
    return NextResponse.json(
      { error: "Failed to fetch agent stats" },
      { status: 500 }
    );
  }
}
