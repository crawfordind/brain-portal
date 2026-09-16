/**
 * Guardrails Evolution Engine
 *
 * Periodically analyzes user interaction patterns to auto-learn preferences.
 * This runs in the background — never blocks a request.
 *
 * Evolution triggers:
 * - Every 25 interactions, the system re-evaluates learned context
 * - Uses agent task feedback (approvals, rejections, revision requests) as signal
 * - Uses chat conversation patterns as secondary signal
 *
 * The learned_context is additive — it never removes user-set guardrails,
 * only adds system-observed patterns that supplement them.
 */

import { queryAll } from "@/lib/db/client";
import { complete } from "@/lib/ai/client";
import { getGuardrails, updateLearnedContext } from "./service";

const EVOLUTION_INTERVAL = 25; // evolve every N interactions

/**
 * Check if evolution should run, and if so, trigger it.
 * Call this after incrementing interaction count.
 * Returns true if evolution was triggered.
 */
export async function maybeEvolve(userId: string, interactionCount: number): Promise<boolean> {
  if (interactionCount < EVOLUTION_INTERVAL) return false;
  if (interactionCount % EVOLUTION_INTERVAL !== 0) return false;

  // Run evolution in background (non-blocking)
  evolveGuardrails(userId).catch((err) =>
    console.error("[Evolution] Failed:", err)
  );

  return true;
}

/**
 * Analyze recent interactions and update learned context.
 */
async function evolveGuardrails(userId: string): Promise<void> {
  const guardrails = await getGuardrails(userId);
  if (!guardrails.id) return; // No guardrails row yet

  console.log(`[Evolution] Starting evolution for user ${userId} (v${guardrails.evolution_version})`);

  // Gather signals from recent agent task feedback
  const recentFeedback = await queryAll<{
    feedback_type: string;
    feedback_text: string;
    agent_type: string;
  }>(
    `SELECT atf.feedback_type, atf.feedback_text, at2.assigned_agent as agent_type
     FROM agent_task_feedback atf
     JOIN agent_tasks at2 ON at2.id = atf.agent_task_id
     WHERE at2.user_id = ?
     ORDER BY atf.created_at DESC
     LIMIT 20`,
    [userId]
  );

  // Gather signals from recent chat messages
  const recentChats = await queryAll<{ content: string; role: string }>(
    `SELECT cm.content, cm.role
     FROM chat_messages cm
     JOIN chat_conversations cc ON cc.id = cm.conversation_id
     WHERE cc.user_id = ?
     ORDER BY cm.created_at DESC
     LIMIT 30`,
    [userId]
  );

  // Not enough signal to evolve
  if (recentFeedback.length < 3 && recentChats.length < 5) {
    console.log("[Evolution] Not enough signal, skipping");
    return;
  }

  // Build analysis prompt
  const feedbackSummary = recentFeedback
    .map((f) => `[${f.feedback_type}] ${f.agent_type}: ${f.feedback_text || "(no text)"}`)
    .join("\n");

  const chatSummary = recentChats
    .filter((c) => c.role === "user")
    .slice(0, 15)
    .map((c) => c.content.substring(0, 200))
    .join("\n");

  const currentLearned = guardrails.learned_context;

  const prompt = `Analyze these recent user interactions to identify implicit preferences and patterns.

FEEDBACK ON AI OUTPUTS (approvals, rejections, revision requests):
${feedbackSummary || "None available"}

RECENT USER MESSAGES:
${chatSummary || "None available"}

CURRENT LEARNED CONTEXT:
${currentLearned}

Extract a concise JSON object with observed user preferences. Only include patterns you're confident about (appeared 2+ times). Be specific and actionable.

Return JSON:
{
  "preferences": "one sentence about general preferences observed",
  "patterns": ["specific pattern 1", "specific pattern 2"],
  "working_style": "one sentence about how they work"
}

If there isn't enough signal to update, return the current learned context unchanged.`;

  try {
    const response = await complete(prompt, {
      slot: "fast",
      userId,
      maxTokens: 300,
      temperature: 0.3,
    });

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.log("[Evolution] No valid JSON in response, skipping");
      return;
    }

    const newLearned = JSON.parse(jsonMatch[0]);
    const newVersion = guardrails.evolution_version + 1;

    await updateLearnedContext(userId, newLearned, newVersion);
    console.log(`[Evolution] Updated to v${newVersion}`);
  } catch (err) {
    console.error("[Evolution] Analysis failed:", err);
  }
}

/**
 * Force an evolution cycle (for manual trigger from settings)
 */
export async function forceEvolve(userId: string): Promise<Record<string, unknown>> {
  const guardrails = await getGuardrails(userId);

  // Ensure the row exists
  if (!guardrails.id) {
    return {};
  }

  await evolveGuardrails(userId);

  // Return updated learned context
  const updated = await getGuardrails(userId);
  try {
    return JSON.parse(updated.learned_context);
  } catch {
    return {};
  }
}
