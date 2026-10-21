/**
 * Calling the Responses API on a ChatGPT plan.
 *
 * OpenAI's preview rules for plan usage, all followed here: `store: false`
 * and `stream: true` on every request (a non-streamed one is refused), the
 * system prompt in `instructions` (a system message is rejected), and no
 * `temperature`, `max_output_tokens` or other optional fields, since the
 * preview rejects ones it doesn't support. A usage limit can arrive as a
 * `response.failed` event after the stream has opened, so it is read from the
 * stream as well as from the status code.
 */

import {
  CHATGPT_API_BASE,
  classifyChatGptError,
  parseChatGptModelCatalog,
  toResponsesRequest,
  type ChatGptModel,
} from "./types";
import type { UsageTokens } from "../usage/types";
import { tokenCount } from "../usage/types";

const TIMEOUT_MS = 180_000;

export class ChatGptPlanError extends Error {
  readonly status: number;
  readonly code: string | null;
  /** True when another provider should be tried. */
  readonly fallback: boolean;
  constructor(message: string, options: { status: number; code: string | null; fallback: boolean }) {
    super(message);
    this.name = "ChatGptPlanError";
    this.status = options.status;
    this.code = options.code;
    this.fallback = options.fallback;
  }
}

function planError(status: number, body: unknown): ChatGptPlanError {
  const b = (body ?? {}) as { error?: { code?: string; message?: string } | string; detail?: string; code?: string };
  const code = typeof b.error === "object" ? b.error?.code ?? null : b.code ?? null;
  const known = classifyChatGptError(code);
  const raw = (typeof b.error === "object" ? b.error?.message : typeof b.error === "string" ? b.error : null) ?? b.detail ?? null;
  return new ChatGptPlanError(known?.message ?? `ChatGPT plan request failed (${status})${raw ? `: ${raw}` : ""}`, {
    status: code === "subscription_sharing_usage_limit_exceeded" ? 429 : status,
    code,
    // Every plan failure is worth another provider: auth, limits, outages.
    fallback: known?.fallback ?? (status === 401 || status === 403 || status === 429 || status >= 500),
  });
}

export interface ChatGptStreamEvent {
  text?: string;
  model?: string;
  usage?: UsageTokens;
}

/** The raw event stream, as text deltas plus the final model and usage. */
export async function* chatGptStream(
  input: {
    accessToken: string;
    model: string;
    messages: Array<{ role: string; content?: unknown }>;
  },
  fetchImpl: typeof fetch = fetch
): AsyncGenerator<ChatGptStreamEvent> {
  const { instructions, input: items } = toResponsesRequest(input.messages);
  const res = await fetchImpl(`${CHATGPT_API_BASE}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      model: input.model,
      ...(instructions ? { instructions } : {}),
      input: items,
      store: false,
      stream: true,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok || !res.body) {
    throw planError(res.status, await res.json().catch(() => null));
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = block
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!data || data === "[DONE]") continue;
        let event: {
          type?: string;
          delta?: string;
          response?: { model?: string; usage?: { input_tokens?: number; output_tokens?: number }; error?: { code?: string; message?: string } };
          error?: { code?: string; message?: string };
          code?: string;
          message?: string;
        };
        try {
          event = JSON.parse(data);
        } catch {
          continue;
        }
        if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
          yield { text: event.delta };
        } else if (event.type === "response.completed" || event.type === "response.incomplete") {
          yield {
            model: event.response?.model,
            usage: {
              inputTokens: tokenCount(event.response?.usage?.input_tokens),
              outputTokens: tokenCount(event.response?.usage?.output_tokens),
            },
          };
        } else if (event.type === "response.failed") {
          throw planError(500, { error: event.response?.error });
        } else if (event.type === "error") {
          throw planError(500, { error: event.error ?? { code: event.code, message: event.message } });
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** The whole answer at once, for non-streaming callers. */
export async function chatGptComplete(
  input: Parameters<typeof chatGptStream>[0],
  fetchImpl: typeof fetch = fetch
): Promise<{ content: string; model: string; finishReason: string | null; usage: UsageTokens }> {
  let content = "";
  let model = input.model;
  let usage: UsageTokens = { inputTokens: 0, outputTokens: 0 };
  for await (const event of chatGptStream(input, fetchImpl)) {
    if (event.text) content += event.text;
    if (event.model) model = event.model;
    if (event.usage) usage = event.usage;
  }
  return { content, model, finishReason: "stop", usage };
}

/**
 * The models this plan offers, as OpenAI lists them for a picker, or why
 * they couldn't be read. The reason is logged and shown, so "no models"
 * never again hides what actually went wrong.
 */
export async function chatGptModelList(
  accessToken: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ models: ChatGptModel[]; error: string | null }> {
  try {
    const res = await fetchImpl(`${CHATGPT_API_BASE}/models`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const err = planError(res.status, body);
      console.warn(`[chatgpt] model list failed (${res.status}${err.code ? `, ${err.code}` : ""}): ${err.message}`);
      return { models: [], error: err.message };
    }
    const models = parseChatGptModelCatalog(body);
    if (models.length === 0) {
      const keys = body && typeof body === "object" ? Object.keys(body).join(", ") : typeof body;
      console.warn(`[chatgpt] model list was empty (response keys: ${keys})`);
      return { models, error: "ChatGPT returned an empty model list for this plan." };
    }
    return { models, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[chatgpt] model list unreachable: ${message}`);
    return { models: [], error: `Couldn't reach ChatGPT to list models (${message}).` };
  }
}

/** Just the slugs, best first; null when they couldn't be read. */
export async function chatGptModelIds(accessToken: string, fetchImpl: typeof fetch = fetch): Promise<string[] | null> {
  const { models, error } = await chatGptModelList(accessToken, fetchImpl);
  return error && models.length === 0 ? null : models.map((m) => m.slug);
}
