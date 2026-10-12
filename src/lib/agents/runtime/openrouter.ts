/**
 * The OpenRouter runtime: one model call per run, no tools, no approvals.
 *
 * This is the default runtime and the one a fresh install gets with nothing
 * but `OPENROUTER_API_KEY`. It is the only file on the delegated-task path
 * allowed to import OpenRouter code (`tests/lib/agents/runtime/boundaries.test.ts`
 * enforces it), and the dispatcher reaches it only when `AGENT_RUNTIME` is
 * `openrouter`. Nothing falls back to it.
 *
 * The completion logic is the earlier executor's, unchanged in substance: the
 * agent type's persona from `agent_configs` (when there is one) with a pinned
 * model at the head of the chain, an adaptive token budget, and an empty
 * answer treated as a failure rather than stored as a blank version.
 */

import { completeWithMeta } from "@/lib/ai/client";
import { getModelChain } from "@/lib/ai/models";
import { queryOne } from "@/lib/db/client";
import { RuntimeError } from "./errors";

export interface OpenRouterTaskRequest {
  userId: string;
  /** `agent_tasks.assigned_agent`: picks the persona, if one is configured. */
  agentType: string;
  sourceType: string;
  instructionLength: number;
  isRevision: boolean;
  input: string;
  instructions: string;
}

export interface OpenRouterTaskResult {
  output: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
}

/** Injected in tests; the real one is `completeWithMeta`. */
export type CompleteFn = typeof completeWithMeta;

/** Short sources need ~1k tokens; full tasks and notes benefit from more room. */
export function tokenBudget(sourceType: string, instructionLength: number): number {
  switch (sourceType) {
    case "capture":
    case "thought":
      return instructionLength < 200 ? 1500 : 2500;
    case "reminder":
      return 1500;
    case "insight":
      return 2500;
    case "note":
    case "journal":
      return instructionLength < 500 ? 2500 : 4096;
    default:
      return instructionLength < 200 ? 2500 : 4096;
  }
}

export async function runOpenRouterTask(
  request: OpenRouterTaskRequest,
  complete: CompleteFn = completeWithMeta
): Promise<OpenRouterTaskResult> {
  let persona: { system_prompt: string | null; model_id: string | null } | null = null;
  try {
    persona = await queryOne<{ system_prompt: string | null; model_id: string | null }>(
      "SELECT system_prompt, model_id FROM agent_configs WHERE agent_type = ? AND is_active = TRUE",
      [request.agentType]
    );
  } catch {
    // agent_configs is optional: without it every type runs as the generalist.
  }

  const system = persona?.system_prompt
    ? `${persona.system_prompt}\n\n${request.instructions}`
    : request.instructions;
  const chain = await getModelChain("agent", request.userId);
  const models = persona?.model_id ? [persona.model_id, ...chain.filter((m) => m !== persona!.model_id)] : chain;
  const maxTokens = tokenBudget(request.sourceType, request.instructionLength);
  const options = {
    system,
    models,
    maxTokens,
    temperature: request.isRevision ? 0.4 : 0.7,
    retries: 2,
  };

  let first;
  try {
    first = await complete(request.input, options);
  } catch (error) {
    throw providerError(error);
  }
  let content = first.content.trim();
  let served = first.model;

  // Reasoning models can spend the whole budget on hidden tokens and emit
  // nothing visible; one retry with a doubled budget usually clears it.
  if (!content && first.finishReason === "length") {
    try {
      const retry = await complete(request.input, { ...options, maxTokens: Math.min(maxTokens * 2, 8192) });
      content = retry.content.trim();
      served = retry.model;
    } catch (error) {
      throw providerError(error);
    }
  }

  if (!content) {
    throw new RuntimeError(
      "bad_response",
      `Model ${served || models[0] || "unknown"} returned an empty response (finish_reason: ${first.finishReason ?? "unknown"})`
    );
  }

  return {
    output: content,
    model: served || models[0] || "openrouter",
    // Rough estimates, as before: the provider's usage is not surfaced here.
    tokensIn: Math.ceil((system.length + request.input.length) / 4),
    tokensOut: Math.ceil(content.length / 4),
  };
}

/**
 * Keep the provider's own wording ("402 Insufficient credits"): System Health
 * maps it to a plain-language diagnosis. It is redacted before it is stored.
 */
function providerError(error: unknown): RuntimeError {
  const message = error instanceof Error ? error.message : "OpenRouter request failed";
  return new RuntimeError("server", message.slice(0, 500));
}
