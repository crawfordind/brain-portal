/**
 * Claude, called with a person's own Anthropic key, through Anthropic's SDK.
 *
 * The rest of the app builds OpenAI-style chat messages (that is what
 * OpenRouter and OpenAI take). This module converts them, makes the request,
 * and hands back text in the same shape `client.ts` returns for the others.
 *
 * Request choices, all deliberate:
 *
 * - No `temperature`: current Claude models reject sampling parameters.
 * - No `thinking` field: adaptive thinking is the default, and an explicit
 *   "disabled" is a 400 on Claude Opus 5.5. Depth is set with `effort`, light
 *   for background jobs and heavier for reviews and agents.
 * - A generous `max_tokens`: thinking spends from the same budget, so a 300
 *   token cap meant for a short tag list could leave no room for the answer.
 *   It is a ceiling, not a charge.
 * - Refusal fallbacks (`fallbacks: "default"`) on models that accept them, so
 *   a declined request is retried server-side on a model suited to it.
 * - A refusal that survives is an error with Claude's reason, never an empty
 *   string the caller would store as output.
 */

import Anthropic from "@anthropic-ai/sdk";
import type OpenAI from "openai";

type BetaMessageParam = Anthropic.Beta.BetaMessageParam;
type BetaContentBlockParam = Anthropic.Beta.BetaContentBlockParam;
type Effort = "low" | "medium" | "high";

/** Floor for `max_tokens`, because thinking draws from the same budget. */
const MIN_MAX_TOKENS = 16_000;
const MAX_STREAM_TOKENS = 64_000;

const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** Models that accept the `fallbacks: "default"` refusal routing. */
function acceptsDefaultFallbacks(model: string): boolean {
  return /^claude-(opus-5-5|opus-5|fable-5-1|sonnet-5-5)$/.test(model);
}

/** Models that accept `output_config.effort`. Older Haiku and Sonnet 4.5 reject it. */
function acceptsEffort(model: string): boolean {
  return /^claude-(opus-5|opus-4-[5-8]|fable|mythos|sonnet-5|sonnet-4-6|haiku-5)/.test(model);
}

export class ClaudeRefusalError extends Error {
  readonly status = 400;
  constructor(category: string | null, explanation: string | null) {
    super(
      `Claude declined this request${category ? ` (${category})` : ""}.${explanation ? ` ${explanation}` : ""}`
    );
    this.name = "ClaudeRefusalError";
  }
}

/** `data:image/png;base64,....` → an image block; a URL → a URL image block. */
function imageBlock(url: string): BetaContentBlockParam | null {
  const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,(.+)$/i.exec(url);
  if (match) {
    return {
      type: "image",
      source: {
        type: "base64",
        media_type: match[1].toLowerCase() as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
        data: match[2],
      },
    };
  }
  if (/^https:\/\//i.test(url)) return { type: "image", source: { type: "url", url } };
  return null;
}

function toBlocks(content: OpenAI.ChatCompletionMessageParam["content"]): string | BetaContentBlockParam[] {
  if (typeof content === "string" || content == null) return content ?? "";
  const blocks: BetaContentBlockParam[] = [];
  for (const part of content as Array<{ type: string; text?: string; image_url?: { url: string } }>) {
    if (part.type === "text" && part.text) blocks.push({ type: "text", text: part.text });
    else if (part.type === "image_url" && part.image_url?.url) {
      const block = imageBlock(part.image_url.url);
      if (block) blocks.push(block);
    }
  }
  return blocks;
}

/**
 * OpenAI-style messages → Claude's `system` + `messages`. System messages
 * join the top-level system prompt; Claude's first message must be the user's.
 */
export function toClaudeMessages(messages: OpenAI.ChatCompletionMessageParam[]): {
  system: string | undefined;
  messages: BetaMessageParam[];
} {
  const system: string[] = [];
  const out: BetaMessageParam[] = [];
  for (const message of messages) {
    if (message.role === "system" || message.role === "developer") {
      const text = typeof message.content === "string" ? message.content : "";
      if (text) system.push(text);
      continue;
    }
    if (message.role !== "user" && message.role !== "assistant") continue;
    out.push({ role: message.role, content: toBlocks(message.content as OpenAI.ChatCompletionMessageParam["content"]) });
  }
  while (out.length > 0 && out[0].role !== "user") out.shift();
  return { system: system.length > 0 ? system.join("\n\n") : undefined, messages: out };
}

function requestBody(input: {
  model: string;
  messages: OpenAI.ChatCompletionMessageParam[];
  maxTokens: number;
  effort: Effort;
  stream: boolean;
}) {
  const { system, messages } = toClaudeMessages(input.messages);
  const fallbacks = acceptsDefaultFallbacks(input.model);
  return {
    model: input.model,
    max_tokens: input.stream
      ? Math.min(MAX_STREAM_TOKENS, Math.max(input.maxTokens, MIN_MAX_TOKENS))
      : Math.max(input.maxTokens, MIN_MAX_TOKENS),
    ...(system ? { system } : {}),
    messages,
    ...(acceptsEffort(input.model) ? { output_config: { effort: input.effort } } : {}),
    ...(fallbacks ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
  };
}

export interface ClaudeResult {
  content: string;
  /** Mapped onto OpenAI's vocabulary: "stop" | "length" | the raw reason. */
  finishReason: string | null;
  model: string;
}

function mapStopReason(reason: string | null): string | null {
  if (reason === "end_turn" || reason === "stop_sequence") return "stop";
  if (reason === "max_tokens") return "length";
  return reason;
}

export async function claudeComplete(
  client: Anthropic,
  input: { model: string; messages: OpenAI.ChatCompletionMessageParam[]; maxTokens: number; effort: Effort }
): Promise<ClaudeResult> {
  const response = await client.beta.messages.create({
    ...requestBody({ ...input, stream: false }),
    stream: false,
  } as Anthropic.Beta.MessageCreateParamsNonStreaming);

  if (response.stop_reason === "refusal") {
    throw new ClaudeRefusalError(response.stop_details?.category ?? null, response.stop_details?.explanation ?? null);
  }

  const content = response.content
    .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  return { content, finishReason: mapStopReason(response.stop_reason), model: response.model || input.model };
}

/** Text deltas only; thinking blocks are not shown to the person. */
export async function* claudeStream(
  client: Anthropic,
  input: { model: string; messages: OpenAI.ChatCompletionMessageParam[]; maxTokens: number; effort: Effort }
): AsyncGenerator<string> {
  const stream = await client.beta.messages.create({
    ...requestBody({ ...input, stream: true }),
    stream: true,
  } as Anthropic.Beta.MessageCreateParamsStreaming);

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      yield event.delta.text;
    } else if (event.type === "message_delta" && event.delta.stop_reason === "refusal") {
      const details = (event.delta as { stop_details?: { category?: string | null; explanation?: string | null } | null })
        .stop_details;
      throw new ClaudeRefusalError(details?.category ?? null, details?.explanation ?? null);
    }
  }
}
