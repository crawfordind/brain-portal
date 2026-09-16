/**
 * Skill Executor
 *
 * Executes skills with full audit logging, rate limiting, and error handling.
 * Every skill invocation is recorded in the skill_executions table for
 * complete auditability.
 */

import { db, queryOne, queryAll } from "@/lib/db/client";
import type { SkillExecution, SkillTriggerSource } from "@/lib/db/schema";
import {
  getSkill,
  validateSkillInput,
  type SkillContext,
  type SkillResult,
} from "./registry";

export interface ExecuteSkillOptions {
  skillId: string;
  userId: string;
  params: Record<string, unknown>;
  triggerSource: SkillTriggerSource;
  triggerId?: string;
}

export interface ExecuteSkillResult {
  success: boolean;
  executionId: string;
  output: unknown;
  error?: string;
  durationMs: number;
}

/**
 * Execute a skill with full logging and validation.
 */
export async function executeSkill(
  options: ExecuteSkillOptions
): Promise<ExecuteSkillResult> {
  const { skillId, userId, params, triggerSource, triggerId } = options;
  const startTime = Date.now();

  // Create execution record
  await db.execute({
    sql: `INSERT INTO skill_executions
          (skill_id, user_id, trigger_source, trigger_id, input_params, status)
          VALUES (?, ?, ?, ?, ?, 'running')`,
    args: [
      skillId,
      userId,
      triggerSource,
      triggerId || null,
      JSON.stringify(params),
    ],
  });

  // Get the execution ID
  const execution = await queryOne<{ id: string }>(
    `SELECT id FROM skill_executions
     WHERE skill_id = ? AND user_id = ? AND status = 'running'
     ORDER BY created_at DESC LIMIT 1`,
    [skillId, userId]
  );

  const executionId = execution?.id || "unknown";

  // Validate skill exists
  const skill = getSkill(skillId);
  if (!skill) {
    await markFailed(executionId, `Skill "${skillId}" not found`, startTime);
    return {
      success: false,
      executionId,
      output: null,
      error: `Skill "${skillId}" not found`,
      durationMs: Date.now() - startTime,
    };
  }

  // Validate input
  const validation = validateSkillInput(skillId, params);
  if (!validation.valid) {
    const errorMsg = `Invalid input: ${validation.errors.join("; ")}`;
    await markFailed(executionId, errorMsg, startTime);
    return {
      success: false,
      executionId,
      output: null,
      error: errorMsg,
      durationMs: Date.now() - startTime,
    };
  }

  // Check rate limit
  const rateLimitOk = await checkRateLimit(
    skillId,
    userId,
    skill.definition.rateLimitPerHour
  );
  if (!rateLimitOk) {
    const errorMsg = `Rate limit exceeded (${skill.definition.rateLimitPerHour}/hour)`;
    await markFailed(executionId, errorMsg, startTime);
    return {
      success: false,
      executionId,
      output: null,
      error: errorMsg,
      durationMs: Date.now() - startTime,
    };
  }

  // Execute the skill
  try {
    const context: SkillContext = {
      userId,
      triggerSource,
      triggerId,
    };

    // Apply defaults from schema
    const paramsWithDefaults = { ...params };
    for (const [key, def] of Object.entries(skill.definition.inputSchema)) {
      if (!(key in paramsWithDefaults) && def.default !== undefined) {
        paramsWithDefaults[key] = def.default;
      }
    }

    const result: SkillResult = await skill.handler(paramsWithDefaults, context);
    const durationMs = Date.now() - startTime;

    // Mark completed
    await db.execute({
      sql: `UPDATE skill_executions
            SET status = 'completed',
                output = ?,
                duration_ms = ?,
                tokens_used = ?,
                cost_cents = ?
            WHERE id = ?`,
      args: [
        JSON.stringify(result.output),
        durationMs,
        result.tokensUsed || 0,
        result.costCents || 0,
        executionId,
      ],
    });

    return {
      success: result.success,
      executionId,
      output: result.output,
      durationMs,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[SkillExecutor] Skill "${skillId}" failed:`, errorMsg);
    await markFailed(executionId, errorMsg, startTime);

    return {
      success: false,
      executionId,
      output: null,
      error: errorMsg,
      durationMs: Date.now() - startTime,
    };
  }
}

async function markFailed(
  executionId: string,
  error: string,
  startTime: number
): Promise<void> {
  await db.execute({
    sql: `UPDATE skill_executions
          SET status = 'failed',
              error_message = ?,
              duration_ms = ?
          WHERE id = ?`,
    args: [error, Date.now() - startTime, executionId],
  });
}

async function checkRateLimit(
  skillId: string,
  userId: string,
  limitPerHour: number
): Promise<boolean> {
  if (limitPerHour <= 0) return true;

  const result = await queryOne<{ count: number }>(
    `SELECT COUNT(*) as count FROM skill_executions
     WHERE skill_id = ? AND user_id = ?
       AND datetime(created_at) > datetime('now', '-1 hour')`,
    [skillId, userId]
  );

  return (result?.count || 0) < limitPerHour;
}

/**
 * Get execution history for a skill or user.
 */
export async function getSkillExecutions(
  userId: string,
  options?: {
    skillId?: string;
    limit?: number;
    status?: string;
  }
): Promise<SkillExecution[]> {
  const limit = options?.limit || 50;

  if (options?.skillId) {
    return queryAll<SkillExecution>(
      `SELECT * FROM skill_executions
       WHERE user_id = ? AND skill_id = ?
       ORDER BY created_at DESC LIMIT ?`,
      [userId, options.skillId, limit]
    );
  }

  if (options?.status) {
    return queryAll<SkillExecution>(
      `SELECT * FROM skill_executions
       WHERE user_id = ? AND status = ?
       ORDER BY created_at DESC LIMIT ?`,
      [userId, options.status, limit]
    );
  }

  return queryAll<SkillExecution>(
    `SELECT * FROM skill_executions
     WHERE user_id = ?
     ORDER BY created_at DESC LIMIT ?`,
    [userId, limit]
  );
}
