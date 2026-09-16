/**
 * Agent Execution Service
 * Handles agent task processing and revision
 */

import { db, queryOne, queryAll } from "@/lib/db/client";
import { AgentTask, AgentTaskOutput, AgentConfig, DelegationSourceType, Note, Task, Capture, Reminder } from "@/lib/db/schema";
import { complete, completeWithMeta } from "@/lib/ai/client";
import { getModelChain } from "@/lib/ai/models";
import { buildTaskContext, formatContextForPrompt } from "./context";
import { syncTaskStatusFromAgentTask } from "./status-sync";
import { getCompiledGuardrails, incrementInteractionCount, maybeEvolve } from "@/lib/guardrails";
import { buildAnnotationPromptSection } from "@/lib/annotations";
import { injectGuardrails } from "@/lib/guardrails/compiler";

/**
 * Determine max output tokens based on source type and description length.
 * Short captures need ~1k tokens; full tasks/notes benefit from more room.
 */
function getAdaptiveTokenBudget(task: AgentTask): number {
  const sourceType = (task.source_type || "task") as DelegationSourceType;
  const descLen = (task.description || "").length;

  switch (sourceType) {
    case "capture":
    case "thought":
      return descLen < 200 ? 1500 : 2500;
    case "reminder":
      return 1500;
    case "insight":
      return 2500;
    case "note":
      return descLen < 500 ? 2500 : 4096;
    case "task":
    default:
      return descLen < 200 ? 2500 : 4096;
  }
}

async function fetchSourceEntityContent(
  userId: string,
  sourceType: DelegationSourceType,
  sourceId: string | null
): Promise<string | null> {
  if (!sourceId) return null;
  try {
    switch (sourceType) {
      case "note": {
        const note = await queryOne<Note>(
          "SELECT content_plain, content FROM notes WHERE id = ? AND user_id = ?",
          [sourceId, userId]
        );
        return note?.content_plain || note?.content || null;
      }
      case "task": {
        const task = await queryOne<Task>(
          "SELECT description, title, content FROM tasks WHERE id = ? AND user_id = ?",
          [sourceId, userId]
        );
        return task?.description || task?.title || task?.content || null;
      }
      case "capture":
      case "thought": {
        const capture = await queryOne<Capture>(
          "SELECT content FROM captures WHERE id = ? AND user_id = ?",
          [sourceId, userId]
        );
        return capture?.content || null;
      }
      case "reminder": {
        const reminder = await queryOne<Reminder>(
          "SELECT content, title FROM reminders WHERE id = ? AND user_id = ?",
          [sourceId, userId]
        );
        return reminder?.content || reminder?.title || null;
      }
      case "insight": {
        const insight = await queryOne<{ content: string }>(
          "SELECT content FROM insights WHERE id = ? AND user_id = ?",
          [sourceId, userId]
        );
        return insight?.content || null;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/**
 * Semantic highlights the user painted onto the source content.
 *
 * Only notes can carry them — they are the one source type stored as HTML —
 * and they are read from `content`, not `content_plain`, because stripping the
 * tags is exactly what throws the markup away. A highlight is the user's most
 * specific statement of what they want done, so it is fetched independently of
 * the source body: it still applies when the body itself is already in the
 * prompt as the task description.
 */
async function fetchSourceAnnotationSection(
  userId: string,
  sourceType: DelegationSourceType,
  sourceId: string | null
): Promise<string> {
  if (!sourceId || sourceType !== "note") return "";
  try {
    const note = await queryOne<Note>(
      "SELECT content FROM notes WHERE id = ? AND user_id = ?",
      [sourceId, userId]
    );
    return buildAnnotationPromptSection(note?.content);
  } catch {
    return "";
  }
}

/** Statuses from which a worker is allowed to take ownership of a task. */
const CLAIMABLE_STATUSES = ["queued", "revision_requested", "failed"] as const;

/**
 * Run the agent completion, treating an empty body as a failure rather than as
 * a valid (blank) output.
 *
 * Two distinct empty-output causes are handled:
 *  - `finish_reason === "length"` with no content: reasoning models can spend
 *    the whole `max_tokens` budget on hidden reasoning tokens and emit nothing
 *    visible. Retrying once with a doubled budget usually clears it.
 *  - anything else empty: a real failure, so throw and let the retry machinery
 *    re-queue the task instead of storing a blank output as finished work.
 */
async function runAgentCompletion(
  prompt: string,
  options: { system: string; models: string[]; maxTokens: number; temperature: number }
): Promise<string> {
  const first = await completeWithMeta(prompt, { ...options, retries: 2 });
  const content = first.content.trim();
  if (content) return content;

  if (first.finishReason === "length") {
    const retry = await completeWithMeta(prompt, {
      ...options,
      maxTokens: Math.min(options.maxTokens * 2, 8192),
      retries: 2,
    });
    const retryContent = retry.content.trim();
    if (retryContent) return retryContent;
  }

  throw new Error(
    `Model ${options.models[0]} returned an empty response (finish_reason: ${first.finishReason ?? "unknown"})`
  );
}

/**
 * Execute an agent task (initial or revision)
 */
export async function executeAgentTask(taskId: string): Promise<void> {
  // Fetch task
  const task = await queryOne<AgentTask>(
    "SELECT * FROM agent_tasks WHERE id = ?",
    [taskId]
  );

  if (!task) {
    throw new Error(`Task ${taskId} not found`);
  }

  // Claim the task atomically. Both the fire-and-forget call from the API route
  // and the every-minute cron can reach the same task; without this claim they
  // both run it, both compute the same next version number, and the second
  // INSERT trips UNIQUE(agent_task_id, version_number) — marking a task that
  // actually succeeded as failed, after paying for the model call twice.
  const claim = await db.execute({
    sql: `UPDATE agent_tasks
          SET status = 'processing', updated_at = datetime('now')
          WHERE id = ? AND status IN (${CLAIMABLE_STATUSES.map(() => "?").join(", ")})`,
    args: [taskId, ...CLAIMABLE_STATUSES],
  });

  // rowsAffected === 0 means another worker owns it (or it already finished).
  // Not an error — just stand down.
  if (claim?.rowsAffected === 0) {
    console.log(`[Executor] Task ${taskId} already claimed by another worker — skipping`);
    return;
  }

  try {
    const agentConfig = await queryOne<AgentConfig>(
      "SELECT * FROM agent_configs WHERE agent_type = ? AND is_active = TRUE",
      [task.assigned_agent]
    );

    if (!agentConfig) {
      throw new Error(`Agent config not found for ${task.assigned_agent}`);
    }

    let contextNoteIds: string[] = [];
    let contextUrls: string[] = [];
    try { contextNoteIds = JSON.parse(task.context_note_ids) ?? []; } catch { /* malformed data */ }
    try { contextUrls = JSON.parse(task.context_urls) ?? []; } catch { /* malformed data */ }
    const context = await buildTaskContext(
      task.user_id,
      task.description,
      contextNoteIds,
      contextUrls,
      task.project_id,
      task.source_id
    );

    // Persist auto-retrieved context for post-run visibility
    const contextUsed = context.relevantNotes.map((n) => ({
      id: n.id,
      title: n.title,
      similarity: n.similarity,
    }));
    await db.execute({
      sql: "UPDATE agent_tasks SET context_used = ? WHERE id = ?",
      args: [JSON.stringify(contextUsed), taskId],
    });

    // Check if this is a revision
    const previousOutput = await queryOne<AgentTaskOutput>(
      `SELECT * FROM agent_task_outputs
       WHERE agent_task_id = ?
       ORDER BY version_number DESC
       LIMIT 1`,
      [taskId]
    );

    const latestFeedback = previousOutput
      ? await queryOne<{ feedback_text: string }>(
          `SELECT feedback_text FROM agent_task_feedback
           WHERE agent_task_id = ?
           ORDER BY created_at DESC
           LIMIT 1`,
          [taskId]
        )
      : null;

    // Fetch source entity content so the agent sees the original material
    // even when the user provided separate custom instructions.
    const sourceType = (task.source_type || "task") as DelegationSourceType;
    let sourceEntityContent: string | null = null;
    if (task.source_id && sourceType !== "task") {
      const fetched = await fetchSourceEntityContent(task.user_id, sourceType, task.source_id);
      if (fetched && fetched !== task.description) {
        sourceEntityContent = fetched;
      }
    }
    const annotationSection = await fetchSourceAnnotationSection(
      task.user_id,
      sourceType,
      task.source_id
    );

    // Construct prompt
    const prompt = buildPrompt(
      task,
      context,
      previousOutput,
      latestFeedback,
      formatContextForPrompt(context),
      sourceEntityContent,
      annotationSection
    );

    // Inject user guardrails into the agent system prompt
    let systemPrompt = agentConfig.system_prompt;
    try {
      const compiled = await getCompiledGuardrails(task.user_id);
      if (compiled) {
        systemPrompt = injectGuardrails(systemPrompt, compiled);
      }
    } catch {
      // Non-fatal: guardrails table may not exist yet
    }

    // A model pinned on the agent config still wins, but it is now the head of
    // a chain rather than the only option — so a config pinned to an id the
    // provider has since retired degrades instead of failing every task.
    const slotChain = await getModelChain("agent", task.user_id);
    const modelChain = agentConfig.model_id
      ? [agentConfig.model_id, ...slotChain]
      : slotChain;
    const taskModel = modelChain[0];

    const maxTokens = getAdaptiveTokenBudget(task);
    const isRevision = !!previousOutput;
    const startTime = Date.now();
    const output = await runAgentCompletion(prompt, {
      system: systemPrompt,
      models: modelChain,
      maxTokens,
      temperature: isRevision ? 0.4 : 0.7,
    });
    const processingTime = Date.now() - startTime;

    // Estimate tokens (rough)
    const tokensInput = Math.ceil(prompt.length / 4);
    const tokensOutput = Math.ceil(output.length / 4);

    // Generate a 1-sentence summary for quick review (non-blocking).
    // For long outputs, sample both the opening AND the closing — conclusions
    // and recommendations usually live at the end, so a naive head-of-string
    // truncation produces summaries that describe setup without the payoff.
    let summary: string | null = null;
    try {
      const trimmed = output.trim();
      const SUMMARY_MAX = 2000;
      let sampled: string;
      if (trimmed.length <= SUMMARY_MAX) {
        sampled = trimmed;
      } else {
        const head = trimmed.slice(0, 1200);
        const tail = trimmed.slice(-800);
        sampled = `${head}\n\n… [middle omitted] …\n\n${tail}`;
      }
      summary = await complete(
        `Summarize the following in one sentence. State what was produced and its key conclusion or value:\n\n${sampled}`,
        { slot: "fast", userId: task.user_id, maxTokens: 100, temperature: 0.3 }
      );
      summary = summary.trim() || null;
    } catch {
      // Non-fatal: summary is optional
    }

    // Store output. The version number is derived inside SQL from the rows that
    // already exist rather than from the task row we read at the top of this
    // function — that value goes stale the moment a revision lands concurrently,
    // and a stale value collides with UNIQUE(agent_task_id, version_number).
    // model_used is NOT NULL, so fall back to the model actually used when the
    // agent config has no model_id pinned.
    const insertResult = await db.execute({
      sql: `
        INSERT INTO agent_task_outputs
        (agent_task_id, version_number, content, content_type, model_used, tokens_input, tokens_output, processing_time_ms, summary)
        SELECT ?, COALESCE(MAX(version_number), 0) + 1, ?, ?, ?, ?, ?, ?, ?
        FROM agent_task_outputs WHERE agent_task_id = ?
        RETURNING version_number
      `,
      args: [
        taskId,
        output.trim(),
        task.output_format,
        agentConfig.model_id || taskModel,
        tokensInput,
        tokensOutput,
        processingTime,
        summary,
        taskId,
      ],
    });

    const newVersion = Number(
      insertResult?.rows?.[0]?.version_number ?? (task.current_version || 0) + 1
    );

    // Update task — retry_count resets on success so a task that survived one
    // timeout doesn't carry that strike into every later revision and get
    // retired early by the "max retries exceeded" check.
    await db.execute({
      sql: `
        UPDATE agent_tasks
        SET status = 'awaiting_review',
            current_version = ?,
            retry_count = 0,
            last_error = NULL,
            updated_at = datetime('now')
        WHERE id = ?
      `,
      args: [newVersion, taskId],
    });

    // Sync task status
    await syncTaskStatusFromAgentTask(taskId, 'awaiting_review');

    // Track interaction for guardrails evolution (non-blocking)
    try {
      const count = await incrementInteractionCount(task.user_id);
      if (count > 0) maybeEvolve(task.user_id, count);
    } catch {
      // Non-fatal
    }
  } catch (error) {
    // Mark as failed with error message. retry_count is incremented here (not
    // only on the cron's timeout path) so genuine execution errors are bounded
    // by the same budget and the cron can safely re-queue them.
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Executor] Task ${taskId} failed:`, errorMessage);

    await db.execute({
      sql: `
        UPDATE agent_tasks
        SET status = 'failed',
            retry_count = COALESCE(retry_count, 0) + 1,
            last_error = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `,
      args: [errorMessage, taskId],
    });

    // Sync task status
    await syncTaskStatusFromAgentTask(taskId, 'failed');
    throw error;
  }
}

/**
 * Get the contextual instruction prefix based on entity type
 */
function getEntityTypeInstructions(sourceType: DelegationSourceType): string {
  switch (sourceType) {
    case "note":
      return `You are reviewing a NOTE from the user's knowledge base. Your job is to:
1. Provide intelligent, thoughtful feedback on the content
2. Suggest additions, improvements, or areas to expand
3. Offer alternative perspectives or ways to think about the topic differently
4. Propose concrete next steps or action items that arise from this note
5. Identify any gaps, assumptions, or questions worth exploring

IMPORTANT: Do NOT rewrite or replace the original note. Your output is a companion analysis that will be linked alongside it. Be specific and reference parts of the note directly.`;

    case "reminder":
      return `You are helping the user PREPARE for an upcoming reminder. Your job is to:
1. Provide relevant context and background for what the reminder is about
2. Suggest preparation steps or action items to be ready
3. Anticipate what the user might need when this reminder triggers
4. Offer any relevant information that would help them be prepared
5. If the reminder is recurring, suggest optimizations for the routine

IMPORTANT: The original reminder will NOT be deleted. Your output is supplementary preparation material linked to it.`;

    case "thought":
    case "capture":
      return `You are helping the user COMPLETE and EXPAND a thought or idea. Your job is to:
1. Take the seed of the thought and develop it into a more complete idea
2. Explore implications, connections, and downstream effects
3. Identify related concepts or areas worth investigating
4. Suggest concrete ways to act on or develop the thought further
5. Offer different angles or frameworks for thinking about it

IMPORTANT: The original thought/capture will NOT be deleted. Your output is an expansion that will be linked alongside it.`;

    case "insight":
      return `You are exploring an AI-generated INSIGHT further. Your job is to:
1. Validate or challenge the insight with deeper analysis
2. Explore practical applications and implications
3. Identify related patterns or connections worth investigating
4. Suggest concrete actions based on the insight
5. Consider counterarguments or limitations

IMPORTANT: The original insight will NOT be deleted. Your output provides deeper analysis linked to it.`;

    case "task":
    default:
      return `You are completing a TASK. Your job is to:
1. Deliver a complete, production-ready response to the task requirements
2. Be thorough and address all aspects of the request
3. Provide actionable, implementable output

Do not summarize what you are about to do — just do it. No filler, no meta-commentary.`;
  }
}

const PROMPT_STRUCTURAL_TAGS = /(<\/?(?:role|content|context|output_requirements|original_content|previous_output|feedback|revision_instructions|source_entity|annotations)(?:\s[^>]*)?>)/gi;

function escapePromptContent(text: string | null | undefined): string {
  if (!text) return "";
  return text.replace(PROMPT_STRUCTURAL_TAGS, (match) =>
    match.replace(/</g, "＜").replace(/>/g, "＞")
  );
}

/**
 * Build prompt based on whether it's initial or revision
 */
function buildPrompt(
  task: AgentTask,
  context: ReturnType<typeof buildTaskContext> extends Promise<infer T> ? T : never,
  previousOutput: AgentTaskOutput | null,
  latestFeedback: { feedback_text: string } | null,
  formattedContext: string,
  sourceEntityContent?: string | null,
  annotationSection?: string
): string {
  const sourceType = (task.source_type || "task") as DelegationSourceType;
  const entityInstructions = getEntityTypeInstructions(sourceType);
  const safeTitle = escapePromptContent(task.title);
  const safeDescription = escapePromptContent(task.description);

  const sourceSection = sourceEntityContent
    ? `\n<source_entity type="${sourceType}">\n${escapePromptContent(sourceEntityContent)}\n</source_entity>\n`
    : "";

  // The user's highlights. Placed after the content in both branches so the
  // model has read the passages before it is told what to do with them.
  const annotations = annotationSection
    ? `\n<annotations>\n${escapePromptContent(annotationSection)}\n</annotations>\n`
    : "";

  if (!previousOutput) {
    // Initial execution
    return `<role>
${entityInstructions}
</role>
${sourceSection}
<content>
Title: ${safeTitle}

${sourceEntityContent ? "Instructions" : sourceType === "task" ? "Requirements" : "Content"}:
${safeDescription}
</content>
${annotations}
${formattedContext ? `<context>\n${formattedContext}\n</context>` : ""}

<output_requirements>
Format: ${task.output_format}

Deliver a complete, high-quality response. No filler, no meta-commentary, no "I will now..." preambles.
</output_requirements>`;
  } else {
    const safePrevious = escapePromptContent(previousOutput.content);
    const safeFeedback = escapePromptContent(
      latestFeedback?.feedback_text || "No specific feedback provided"
    );

    // Revision
    return `<role>
${entityInstructions}
</role>
${sourceSection}
<original_content>
Title: ${safeTitle}
${sourceEntityContent ? "Instructions" : sourceType === "task" ? "Requirements" : "Content"}: ${safeDescription}
</original_content>
${annotations}
${formattedContext ? `<context>\n${formattedContext}\n</context>\n` : ""}
<previous_output version="${previousOutput.version_number}">
${safePrevious}
</previous_output>

<feedback>
${safeFeedback}
</feedback>

<revision_instructions>
Revise the output based on the feedback above. Rules:
1. Address every point in the feedback — explicitly and completely
2. Do not regress on parts of the output that aren't criticized
3. If feedback is ambiguous, make the most reasonable interpretation and note it in one sentence at the end
4. Deliver the improved output directly — do not explain what you changed
</revision_instructions>`;
  }
}
