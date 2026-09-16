/**
 * Tiered Processing Router
 *
 * Routes AI operations to appropriate cost levels:
 * - local: Free local processing (link extraction, structure analysis, word count)
 * - embedding: Cheap embedding operations ($0.02/M tokens)
 * - fast_llm: Quick LLM calls for summaries, tags ($0.003/1k tokens)
 * - full_llm: Full LLM for complex analysis, weekly reviews ($0.015/1k tokens)
 */

import { complete, completeJSON, openrouter } from "./client";
import type { ModelSlot } from "./models/slots";
import { generateEmbedding, cosineSimilarity } from "./embeddings";
import { processLocally, extractWikilinks } from "../processing/local";
import {
  getCached,
  setCache,
  generateCacheKey,
  hashContent,
} from "../processing/cache";

export type Tier = "local" | "embedding" | "fast_llm" | "full_llm";

export interface TierConfig {
  tier: Tier;
  /**
   * The job this tier does. Resolved at call time against the user's setting
   * and the live OpenRouter catalog, which is what stops a retired model id
   * from silently disabling summaries or tagging.
   */
  slot?: ModelSlot;
  cacheTTL?: number; // hours
  maxTokens?: number;
  temperature?: number;
}

// Default configurations per tier
const TIER_CONFIGS: Record<Tier, TierConfig> = {
  local: {
    tier: "local",
    cacheTTL: 0, // No caching for local, it's instant
  },
  embedding: {
    tier: "embedding",
    slot: "embedding",
    cacheTTL: 168, // 7 days - embeddings rarely change
  },
  fast_llm: {
    tier: "fast_llm",
    slot: "fast",
    cacheTTL: 24, // 24 hours
    maxTokens: 500,
    temperature: 0.3,
  },
  full_llm: {
    tier: "full_llm",
    slot: "deep",
    cacheTTL: 48, // 48 hours
    maxTokens: 2048,
    temperature: 0.6,
  },
};

// Operation definitions with their tier requirements
type OperationType =
  | "extract_links"
  | "analyze_structure"
  | "count_words"
  | "generate_embedding"
  | "find_similar"
  | "generate_summary"
  | "generate_tags"
  | "classify_capture"
  | "generate_insights"
  | "weekly_review";

const OPERATION_TIERS: Record<OperationType, Tier> = {
  // Local operations (free)
  extract_links: "local",
  analyze_structure: "local",
  count_words: "local",

  // Embedding operations (very cheap)
  generate_embedding: "embedding",
  find_similar: "embedding",

  // Fast LLM operations
  generate_summary: "fast_llm",
  generate_tags: "fast_llm",
  classify_capture: "fast_llm",

  // Full LLM operations
  generate_insights: "full_llm",
  weekly_review: "full_llm",
};

export interface ProcessResult<T> {
  result: T;
  tier: Tier;
  cached: boolean;
  tokensUsed?: number;
  costCents?: number;
}

/**
 * Get the tier for an operation
 */
export function getTierForOperation(operation: OperationType): Tier {
  return OPERATION_TIERS[operation] || "full_llm";
}

/**
 * Get configuration for a tier
 */
export function getTierConfig(tier: Tier): TierConfig {
  return TIER_CONFIGS[tier];
}

/**
 * Process content locally (free tier)
 */
export async function processLocal(
  content: string
): Promise<
  ProcessResult<ReturnType<typeof processLocally>>
> {
  const result = processLocally(content);
  return {
    result,
    tier: "local",
    cached: false,
    tokensUsed: 0,
    costCents: 0,
  };
}

/**
 * Generate embedding with caching
 */
export async function processEmbedding(
  userId: string,
  text: string
): Promise<ProcessResult<number[]>> {
  const contentHash = hashContent(text);
  const cacheKey = generateCacheKey("embedding", { hash: contentHash });

  // Check cache
  const cached = await getCached<number[]>(userId, cacheKey);
  if (cached) {
    return {
      result: cached,
      tier: "embedding",
      cached: true,
      tokensUsed: 0,
      costCents: 0,
    };
  }

  // Generate new embedding
  const embedding = await generateEmbedding(text);

  // Cache result
  await setCache(userId, cacheKey, embedding, {
    operation: "generate_embedding",
    tier: "embedding",
    ttlHours: TIER_CONFIGS.embedding.cacheTTL,
  });

  // Estimate tokens (rough: ~4 chars per token)
  const tokensUsed = Math.ceil(text.length / 4);

  return {
    result: embedding,
    tier: "embedding",
    cached: false,
    tokensUsed,
    costCents: tokensUsed * 0.00002, // $0.02 per million tokens
  };
}

/**
 * Generate summary with caching (fast LLM tier)
 */
export async function processSummary(
  userId: string,
  title: string,
  content: string
): Promise<ProcessResult<string>> {
  const contentHash = hashContent(content);
  const cacheKey = generateCacheKey("summary", { title, hash: contentHash });

  // Check cache
  const cached = await getCached<string>(userId, cacheKey);
  if (cached) {
    return {
      result: cached,
      tier: "fast_llm",
      cached: true,
      tokensUsed: 0,
      costCents: 0,
    };
  }

  const config = TIER_CONFIGS.fast_llm;

  const prompt = `Summarize this note in 1-2 sentences. Lead with the core point, then its significance. No preamble.

Title: ${title}

Content:
${content.substring(0, 2000)}`;

  const summary = await complete(prompt, {
    system:
      "Summarize notes. Output the summary only — no intro, no meta-commentary, no 'This note...' openings.",
    slot: config.slot,
    userId,
    maxTokens: config.maxTokens,
    temperature: config.temperature,
  });

  const result = summary.trim();

  // Cache result
  await setCache(userId, cacheKey, result, {
    operation: "generate_summary",
    tier: "fast_llm",
    ttlHours: config.cacheTTL,
    tokensUsed: Math.ceil((prompt.length + result.length) / 4),
  });

  const tokensUsed = Math.ceil((prompt.length + result.length) / 4);

  return {
    result,
    tier: "fast_llm",
    cached: false,
    tokensUsed,
    costCents: tokensUsed * 0.0003, // $0.30 per million tokens
  };
}

/**
 * Generate tags with caching (fast LLM tier)
 */
export async function processTags(
  userId: string,
  title: string,
  content: string
): Promise<ProcessResult<string[]>> {
  const contentHash = hashContent(content);
  const cacheKey = generateCacheKey("tags", { title, hash: contentHash });

  // Check cache
  const cached = await getCached<string[]>(userId, cacheKey);
  if (cached) {
    return {
      result: cached,
      tier: "fast_llm",
      cached: true,
      tokensUsed: 0,
      costCents: 0,
    };
  }

  const config = TIER_CONFIGS.fast_llm;

  const prompt = `Extract 3-5 topic tags for this note. Tags should be specific enough to be useful for search and filtering — not generic. Return a JSON array of lowercase strings only.

Title: ${title}

Content:
${content.substring(0, 2000)}`;

  const response = await complete(prompt, {
    system:
      'Extract topic tags. Output only a valid JSON array: ["tag1", "tag2"]. No explanation, no other text.',
    slot: config.slot,
    userId,
    maxTokens: 100,
    temperature: config.temperature,
  });

  // Parse tags
  let tags: string[] = [];
  try {
    tags = JSON.parse(response.trim());
    if (!Array.isArray(tags)) {
      tags = [];
    }
  } catch {
    // Try to extract from response
    const match = response.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        tags = JSON.parse(match[0]);
      } catch {
        tags = [];
      }
    }
  }

  // Cache result
  await setCache(userId, cacheKey, tags, {
    operation: "generate_tags",
    tier: "fast_llm",
    ttlHours: config.cacheTTL,
    tokensUsed: Math.ceil((prompt.length + response.length) / 4),
  });

  const tokensUsed = Math.ceil((prompt.length + response.length) / 4);

  return {
    result: tags,
    tier: "fast_llm",
    cached: false,
    tokensUsed,
    costCents: tokensUsed * 0.0003,
  };
}

/**
 * Classify capture type with caching (fast LLM tier)
 */
export async function processClassifyCapture(
  userId: string,
  content: string
): Promise<
  ProcessResult<{
    type: string;
    summary: string;
  }>
> {
  const contentHash = hashContent(content);
  const cacheKey = generateCacheKey("classify_capture", { hash: contentHash });

  // Check cache
  const cached = await getCached<{ type: string; summary: string }>(
    userId,
    cacheKey
  );
  if (cached) {
    return {
      result: cached,
      tier: "fast_llm",
      cached: true,
      tokensUsed: 0,
      costCents: 0,
    };
  }

  const config = TIER_CONFIGS.fast_llm;

  const prompt = `Classify this capture. Return JSON with "type" (thought | idea | followup | task | quote | reference) and "summary" (one sentence describing what it is).

Content: ${content}`;

  const response = await complete(prompt, {
    system:
      'Classify content captures. Output only valid JSON: {"type": "...", "summary": "..."}. No other text.',
    slot: config.slot,
    userId,
    maxTokens: 100,
    temperature: config.temperature,
  });

  let result = { type: "thought", summary: content.substring(0, 100) };
  try {
    result = JSON.parse(response.trim());
  } catch {
    // Use defaults
  }

  // Cache result
  await setCache(userId, cacheKey, result, {
    operation: "classify_capture",
    tier: "fast_llm",
    ttlHours: config.cacheTTL,
  });

  const tokensUsed = Math.ceil((prompt.length + response.length) / 4);

  return {
    result,
    tier: "fast_llm",
    cached: false,
    tokensUsed,
    costCents: tokensUsed * 0.0003,
  };
}

/**
 * Estimate cost for an operation
 */
export function estimateCost(
  operation: OperationType,
  inputTokens: number,
  outputTokens: number = 0
): number {
  const tier = OPERATION_TIERS[operation];

  switch (tier) {
    case "local":
      return 0;
    case "embedding":
      return inputTokens * 0.00002; // $0.02/M tokens
    case "fast_llm":
      return (inputTokens + outputTokens) * 0.0003; // ~$0.30/M tokens
    case "full_llm":
      return (inputTokens + outputTokens) * 0.0015; // ~$1.50/M tokens
    default:
      return 0;
  }
}

/**
 * Get usage statistics by tier
 */
export interface TierStats {
  tier: Tier;
  callCount: number;
  tokensUsed: number;
  costCents: number;
  cacheHits: number;
}

// In-memory stats tracking (would be persisted in production)
const stats: Record<Tier, TierStats> = {
  local: { tier: "local", callCount: 0, tokensUsed: 0, costCents: 0, cacheHits: 0 },
  embedding: { tier: "embedding", callCount: 0, tokensUsed: 0, costCents: 0, cacheHits: 0 },
  fast_llm: { tier: "fast_llm", callCount: 0, tokensUsed: 0, costCents: 0, cacheHits: 0 },
  full_llm: { tier: "full_llm", callCount: 0, tokensUsed: 0, costCents: 0, cacheHits: 0 },
};

export function recordUsage(
  tier: Tier,
  tokensUsed: number,
  costCents: number,
  cached: boolean
): void {
  stats[tier].callCount++;
  stats[tier].tokensUsed += tokensUsed;
  stats[tier].costCents += costCents;
  if (cached) {
    stats[tier].cacheHits++;
  }
}

export function getStats(): TierStats[] {
  return Object.values(stats);
}

export function resetStats(): void {
  for (const tier of Object.keys(stats) as Tier[]) {
    stats[tier] = { tier, callCount: 0, tokensUsed: 0, costCents: 0, cacheHits: 0 };
  }
}
