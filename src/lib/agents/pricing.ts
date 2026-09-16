/**
 * Model pricing constants and cost estimation for AI agent tasks.
 *
 * Prices are per 1M tokens, based on OpenRouter pricing.
 */

export interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  // xAI Grok models
  "x-ai/grok-4.1-fast": { inputPer1M: 0.30, outputPer1M: 0.50 },
  "x-ai/grok-4.1": { inputPer1M: 3.00, outputPer1M: 15.00 },
  "x-ai/grok-3": { inputPer1M: 3.00, outputPer1M: 15.00 },
  "x-ai/grok-3-fast": { inputPer1M: 0.30, outputPer1M: 0.50 },
  "x-ai/grok-3-mini": { inputPer1M: 0.30, outputPer1M: 0.50 },
  "x-ai/grok-3-mini-fast": { inputPer1M: 0.10, outputPer1M: 0.10 },

  // OpenAI models
  "openai/gpt-4o": { inputPer1M: 2.50, outputPer1M: 10.00 },
  "openai/gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.60 },
  "openai/gpt-4-turbo": { inputPer1M: 10.00, outputPer1M: 30.00 },
  "openai/o1": { inputPer1M: 15.00, outputPer1M: 60.00 },
  "openai/o1-mini": { inputPer1M: 3.00, outputPer1M: 12.00 },
  "openai/o3-mini": { inputPer1M: 1.10, outputPer1M: 4.40 },

  // Anthropic models
  "anthropic/claude-sonnet-4": { inputPer1M: 3.00, outputPer1M: 15.00 },
  "anthropic/claude-3.5-sonnet": { inputPer1M: 3.00, outputPer1M: 15.00 },
  "anthropic/claude-3-haiku": { inputPer1M: 0.25, outputPer1M: 1.25 },
  "anthropic/claude-3-opus": { inputPer1M: 15.00, outputPer1M: 75.00 },

  // Google models
  "google/gemini-2.0-flash": { inputPer1M: 0.10, outputPer1M: 0.40 },
  "google/gemini-2.5-pro-preview": { inputPer1M: 1.25, outputPer1M: 10.00 },

  // MiniMax models
  "minimax/minimax-m2.5": { inputPer1M: 0.50, outputPer1M: 1.50 },

  // Embedding models (for reference)
  "openai/text-embedding-3-small": { inputPer1M: 0.02, outputPer1M: 0.00 },
};

// Default pricing for unknown models — conservative estimate
const DEFAULT_PRICING: ModelPricing = { inputPer1M: 1.00, outputPer1M: 3.00 };

/**
 * Estimate the dollar cost of a model invocation.
 */
export function estimateCost(
  model: string,
  tokensInput: number,
  tokensOutput: number
): number {
  const pricing = MODEL_PRICING[model] || DEFAULT_PRICING;
  const inputCost = (tokensInput / 1_000_000) * pricing.inputPer1M;
  const outputCost = (tokensOutput / 1_000_000) * pricing.outputPer1M;
  return inputCost + outputCost;
}

/**
 * Average minutes a human would spend on a task that an AI agent completes.
 * Used as a rough metric for "time saved" calculations.
 */
export const ESTIMATED_MINUTES_SAVED_PER_TASK = 15;

/**
 * Format a dollar amount for display.
 */
export function formatCost(dollars: number): string {
  if (dollars < 0.01) return "<$0.01";
  return `$${dollars.toFixed(2)}`;
}

/**
 * Format token count for display (e.g., "1.2M", "45.3K", "892").
 */
export function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}
