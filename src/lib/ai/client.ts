import OpenAI from "openai";
import { computeInsightConfidence } from "./insight-confidence";
import { AUTO_ROUTER_MODEL, type ModelSlot } from "./models/slots";

// OpenRouter uses the OpenAI-compatible API
export const openrouter = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
  defaultHeaders: {
    "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
    "X-Title": "Brain Portal",
  },
});

// Default model - can be overridden
export const DEFAULT_MODEL = process.env.OPENROUTER_MODEL || "x-ai/grok-4.1-fast";

// MiniMax M2.5 — optimized for complex, multi-step productivity tasks:
// SWE-bench 80.2%, document generation, planning, cross-environment agent work.
// Use for full_llm tier operations, agent tasks requiring structured output,
// and any task benefiting from planning-optimized token efficiency.
export const MINIMAX_MODEL = "minimax/minimax-m2.5";

// Streaming completion — returns a ReadableStream of SSE-formatted data
export async function streamComplete(
  messages: OpenAI.ChatCompletionMessageParam[],
  options: {
    model?: string;
    /** Fallback chain; OpenRouter fails over server-side within the request. */
    models?: string[];
    maxTokens?: number;
    temperature?: number;
  } = {}
): Promise<ReadableStream<Uint8Array>> {
  const { maxTokens = 4096, temperature = 0.7 } = options;
  const encoder = new TextEncoder();

  // A stream can't be restarted once bytes are flowing, so the fallback here is
  // OpenRouter's server-side `models` failover rather than a client-side walk.
  const chain =
    options.models && options.models.length > 0
      ? options.models
      : [options.model || DEFAULT_MODEL];

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const stream = await openrouter.chat.completions.create({
          model: chain[0],
          ...(wireFallbackModels(chain) ? { models: wireFallbackModels(chain) } : {}),
          messages,
          max_tokens: maxTokens,
          temperature,
          stream: true,
        });

        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content;
          if (content) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ content })}\n\n`)
            );
          }
        }

        controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
        controller.close();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Stream failed";
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: message })}\n\n`)
        );
        controller.close();
      }
    },
  });
}

export interface CompletionOptions {
  system?: string;
  /** A specific model id. Prefer `slot` — a pinned id is what goes stale. */
  model?: string;
  /**
   * The job being done. Resolves to the user's chosen model for that job, with
   * live-catalog validation and a fallback chain behind it.
   */
  slot?: ModelSlot;
  /** Owner of the work, so their saved model choice applies. */
  userId?: string | null;
  /** An explicit chain, tried in order. Overrides `slot` and `model`. */
  models?: string[];
  /**
   * Set false to fail rather than degrade to the Auto Router. Only sensible
   * when the caller is testing a specific model on purpose.
   */
  allowAutoFallback?: boolean;
  maxTokens?: number;
  temperature?: number;
  /** Number of extra attempts for transient upstream failures (429 / 5xx / network). */
  retries?: number;
  /** Base delay for exponential backoff between retries. */
  retryDelayMs?: number;
}

export interface CompletionResult {
  content: string;
  /** "stop" | "length" | "content_filter" | … — null when upstream omits it. */
  finishReason: string | null;
  /** The model the provider actually served (may differ from the requested one). */
  model: string;
  /** Ids skipped because the provider no longer offers them. */
  skippedModels?: string[];
}

/**
 * OpenRouter rejects a `models` array longer than this with
 * `400 'models' array must have 3 items or fewer`.
 *
 * Our own chain is allowed to be longer — the client-side walk below steps
 * through all of it — but each individual request may only carry a window of
 * three. Sending the whole chain 400s every request, which is how this was
 * found: as an UNKNOWN_ERROR in the System status panel.
 */
const OPENROUTER_MAX_MODELS = 3;

/**
 * The slice of the chain a single request may advertise for server-side
 * failover. Returns undefined when there is nothing to fail over to, so the
 * parameter is omitted rather than sent as a one-element array.
 */
export function wireFallbackModels(chain: string[]): string[] | undefined {
  const window = chain.slice(0, OPENROUTER_MAX_MODELS);
  return window.length > 1 ? window : undefined;
}

// Upstream conditions worth retrying: rate limits, gateway hiccups, dropped
// sockets. Anything else (bad model id, auth, malformed request) fails fast —
// retrying those just burns the caller's time budget.
const TRANSIENT_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const TRANSIENT_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "EAI_AGAIN",
]);

function isTransientError(error: unknown): boolean {
  const status = (error as { status?: number } | null)?.status;
  if (typeof status === "number") return TRANSIENT_STATUS_CODES.has(status);

  const code = (error as { code?: string } | null)?.code;
  if (typeof code === "string" && TRANSIENT_ERROR_CODES.has(code)) return true;

  return error instanceof Error && /timeout|socket hang up|fetch failed/i.test(error.message);
}

/**
 * Does this error mean "that model is gone", as opposed to "that request was
 * bad"?
 *
 * This is the trigger for hopping to the next model in the chain, so it is
 * deliberately keyed on the provider's *message* rather than on HTTP 400
 * alone — a 400 is also what you get for a malformed request, and retrying
 * that against every model in the chain would just be four identical failures.
 */
export function isModelUnavailableError(error: unknown): boolean {
  const status = (error as { status?: number } | null)?.status;
  if (status === 404) return true;

  const message = error instanceof Error ? error.message : String(error ?? "");

  // Phrases only, never a bare "unavailable": this app wraps envelope errors as
  // "Upstream model error: <provider text>", so a loose pattern anchored on the
  // word "model" matches things like "provider unavailable" — a transient
  // outage — and would wrongly abandon a perfectly good model.
  return /not a valid model|no endpoints found|no allowed providers|unknown model|no such model|model not found|does not exist|is not available|no longer available|deprecat|decommission|sunset|retired/i.test(
    message
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Build the ordered list of models to attempt.
 *
 * Kept separate from the request loop so the precedence rules are readable and
 * testable: an explicit chain wins, then an explicit id, then a slot (which
 * consults the user's setting and the live catalog), then the legacy default.
 * The Auto Router is appended last because it cannot 404 — that final entry is
 * what turns "the model was retired" from an outage into a slower answer.
 */
async function buildModelChain(options: CompletionOptions): Promise<string[]> {
  const { models, model, slot, userId, allowAutoFallback = true } = options;

  let chain: string[];

  if (models && models.length > 0) {
    chain = [...models];
  } else if (model) {
    chain = [model];
  } else if (slot) {
    // Imported lazily: this pulls in the database client, and the many call
    // sites that pass an explicit model should not pay for that.
    const { getModelChain } = await import("./models");
    chain = await getModelChain(slot, userId);
  } else {
    chain = [DEFAULT_MODEL];
  }

  chain = chain.filter((id, index) => id && chain.indexOf(id) === index);

  if (allowAutoFallback && !chain.includes(AUTO_ROUTER_MODEL)) {
    chain.push(AUTO_ROUTER_MODEL);
  }

  return chain.length > 0 ? chain : [DEFAULT_MODEL];
}

/**
 * Completion helper that surfaces provider metadata alongside the text.
 *
 * `complete()` collapses everything to a string, which hides two failure modes
 * that matter for long-running agent work: an empty body (the provider returned
 * an error envelope with HTTP 200, or a reasoning model spent its entire budget
 * on hidden tokens) and a truncated body (`finish_reason === "length"`). Callers
 * that need to distinguish "the model said nothing" from "the model said
 * nothing useful" should use this.
 */
export async function completeWithMeta(
  prompt: string,
  options: CompletionOptions = {}
): Promise<CompletionResult> {
  const {
    system,
    maxTokens = 2048,
    temperature = 0.7,
    retries = 0,
    retryDelayMs = 1000,
  } = options;

  const messages: OpenAI.ChatCompletionMessageParam[] = [];

  if (system) {
    messages.push({ role: "system", content: system });
  }

  messages.push({ role: "user", content: prompt });

  const chain = await buildModelChain(options);
  const skippedModels: string[] = [];
  let lastError: unknown;

  // Outer loop walks the fallback chain; inner loop is the existing backoff for
  // a transient blip on the model we are currently trying.
  for (let index = 0; index < chain.length; index++) {
    const model = chain[index];
    const remaining = chain.slice(index);

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await openrouter.chat.completions.create({
          model,
          messages,
          max_tokens: maxTokens,
          temperature,
          // OpenRouter-specific: hand it the next few models so it can fail
          // over server-side, within this one request, when a provider is down
          // or rate-limited. Capped at the API's limit — our own loop still
          // walks the rest of the chain, and covers the case this doesn't:
          // an id that no longer exists at all.
          ...(wireFallbackModels(remaining) ? { models: wireFallbackModels(remaining) } : {}),
        } as OpenAI.ChatCompletionCreateParamsNonStreaming);

        // OpenRouter can answer HTTP 200 with an error envelope and no choices.
        // Without this the caller silently receives "" and treats it as output.
        const envelopeError = (response as unknown as { error?: { message?: string; code?: number } })
          .error;
        if (envelopeError) {
          const err = new Error(
            `Upstream model error: ${envelopeError.message || "unknown error"}`
          ) as Error & { status?: number };
          if (typeof envelopeError.code === "number") err.status = envelopeError.code;
          throw err;
        }

        const choice = response.choices?.[0];
        return {
          content: choice?.message?.content ?? "",
          finishReason: choice?.finish_reason ?? null,
          model: response.model || model,
          ...(skippedModels.length > 0 ? { skippedModels } : {}),
        };
      } catch (error) {
        lastError = error;

        // The one condition that earns a client-side hop: this id no longer
        // exists, so no number of retries and no amount of server-side routing
        // will help. Move down the chain.
        if (isModelUnavailableError(error)) {
          console.error(
            `[AI] model ${model} is unavailable; falling back to ${chain[index + 1] ?? "nothing"}`
          );
          skippedModels.push(model);
          break;
        }

        // Everything else — provider down, rate limit, bad request — is either
        // already handled inside the request by OpenRouter's `models` failover,
        // or is a caller error that every model in the chain would reject.
        // Hopping again here would just double the spend, so the original
        // retry-then-give-up contract stands.
        if (attempt === retries || !isTransientError(error)) throw error;

        await sleep(retryDelayMs * 2 ** attempt);
      }
    }
  }

  throw lastError;
}

// Simple completion helper
export async function complete(
  prompt: string,
  options: CompletionOptions = {}
): Promise<string> {
  const { content } = await completeWithMeta(prompt, options);
  return content;
}

// Structured output helper (for JSON responses)
export async function completeJSON<T>(
  prompt: string,
  options: Omit<CompletionOptions, "temperature"> = {}
): Promise<T> {
  const systemPrompt = `${options.system || ""}\n\nYou must respond with valid JSON only. No markdown, no explanations, just the JSON object.`.trim();

  const response = await complete(prompt, {
    ...options,
    system: systemPrompt,
    temperature: 0.3, // Lower temperature for structured output
  });

  return parseJSONResponse<T>(response);
}

/**
 * Parse a (possibly noisy) LLM response as JSON.
 *
 * Strategy, in order:
 *   1. Strip common markdown code fences (```json … ```).
 *   2. Try parsing the trimmed response directly — the fast path when the
 *      model respected the "JSON only" instruction.
 *   3. Fall back to scanning for a balanced JSON object or array and parsing
 *      that. We match brace depth rather than using a greedy regex so we
 *      stop at the first complete structure, which avoids joining two
 *      separate JSON blocks or trailing prose containing stray braces.
 */
export function parseJSONResponse<T>(raw: string): T {
  let text = raw.trim();

  // Strip markdown fences: ```json\n...\n``` or ```\n...\n```
  const fenceMatch = text.match(/^```(?:json|JSON)?\s*\n?([\s\S]*?)\n?```\s*$/);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  // Fast path: whole response is already valid JSON
  try {
    return JSON.parse(text) as T;
  } catch {
    // Fall through to balanced-scan
  }

  // Find the first `{` or `[` and scan for the matching closing brace,
  // respecting nesting and string literals.
  const extracted = extractBalancedJSON(text);
  if (extracted === null) {
    throw new Error("No valid JSON found in response");
  }

  return JSON.parse(extracted) as T;
}

function extractBalancedJSON(text: string): string | null {
  const start = text.search(/[{[]/);
  if (start === -1) return null;

  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === "\\" && inString) {
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === open) {
      depth++;
    } else if (ch === close) {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}

// Insight types
interface InsightContext {
  focusNote: { title: string; content: string } | null;
  recentNotes: { id: string; title: string; content: string; type: string }[];
  captures: { id: string; content: string; type: string }[];
  dailySummaries: { date: string; content: string }[];
}

interface GeneratedInsight {
  type: "connection" | "pattern" | "gap" | "leverage" | "question" | "theme" | "action" | "summary";
  title: string;
  content: string;
  sourceNoteIds?: string[];
  sourceCaptureIds?: string[];
  confidence: number;
}

function formatInsightContext(context: InsightContext): string {
  const sections: string[] = [];

  if (context.focusNote) {
    sections.push(`## Focus Note\n### ${context.focusNote.title}\n${context.focusNote.content}\n`);
  }

  if (context.recentNotes.length > 0) {
    sections.push("## Notes");
    for (const note of context.recentNotes) {
      sections.push(`### ${note.title} [id: ${note.id}, type: ${note.type}]\n${note.content}\n`);
    }
  }

  if (context.captures.length > 0) {
    sections.push("## Captures");
    for (const capture of context.captures) {
      sections.push(`- [${capture.type}, id: ${capture.id}] ${capture.content}`);
    }
    sections.push("");
  }

  if (context.dailySummaries.length > 0) {
    sections.push("## Daily Notes");
    for (const daily of context.dailySummaries) {
      sections.push(`### ${daily.date}\n${daily.content}\n`);
    }
  }

  return sections.join("\n");
}

// Generate insights from user's notes and captures
export async function generateInsights(
  context: InsightContext,
  options?: { guardrails?: string }
): Promise<GeneratedInsight[]> {
  const { INSIGHT_SYSTEM_PROMPT, INSIGHT_GENERATION_PROMPT } = await import("./prompts");

  const contextStr = formatInsightContext(context);
  const prompt = INSIGHT_GENERATION_PROMPT.replace("{context}", contextStr);

  let systemPrompt = INSIGHT_SYSTEM_PROMPT;
  if (options?.guardrails) {
    systemPrompt = `${options.guardrails}\n\n${systemPrompt}`;
  }

  interface RawInsight {
    type: string;
    title: string;
    content: string;
    source_notes?: string[];
    confidence?: number;
  }

  interface AIResponse {
    connections?: RawInsight[];
    patterns?: RawInsight[];
    gaps?: RawInsight[];
    leverage?: RawInsight[];
    questions?: RawInsight[];
  }

  const response = await completeJSON<AIResponse>(prompt, {
    system: systemPrompt,
    maxTokens: 2048,
  });

  // Flatten and format insights
  const insights: GeneratedInsight[] = [];

  const processCategory = (items: RawInsight[] | undefined, type: GeneratedInsight["type"]) => {
    if (!items) return;
    for (const item of items) {
      // Compute confidence from real signals (evidence count + type) rather
      // than trusting the LLM's near-constant self-reported number.
      const sourceNoteCount = Array.isArray(item.source_notes)
        ? item.source_notes.length
        : 0;
      insights.push({
        type,
        title: item.title,
        content: item.content,
        sourceNoteIds: item.source_notes,
        confidence: computeInsightConfidence(sourceNoteCount, type),
      });
    }
  };

  processCategory(response.connections, "connection");
  processCategory(response.patterns, "pattern");
  processCategory(response.gaps, "gap");
  processCategory(response.leverage, "leverage");
  processCategory(response.questions, "question");

  return insights;
}

// Weekly review context
interface WeeklyContext {
  weekStart: string;
  weekEnd: string;
  weekNumber: number;
  year: number;
  dailyNotes: { date: string; mood?: string; energyLevel?: number; content: string }[];
  completedTasks: { content: string; project?: string }[];
  pendingTasks?: { content: string; project?: string; status?: string; dueDate?: string }[];
  captures: { content: string; type: string }[];
  activeNotes: { title: string; type: string; project?: string; wordCount: number }[];
  stats: {
    dailyNotesCount: number;
    tasksCompleted: number;
    capturesCount: number;
    notesWorkedOn: number;
  };
  previousWeekStats?: {
    tasksCompleted: number;
    capturesCount: number;
    notesWorkedOn: number;
    dailyNotesCount: number;
  };
  previousFocus?: string;
}

// Generate weekly review content
export async function generateWeeklyReview(
  context: WeeklyContext,
  options?: { guardrails?: string }
): Promise<string> {
  const { WEEKLY_REVIEW_SYSTEM_PROMPT, WEEKLY_REVIEW_PROMPT } = await import("./prompts");

  // Format the context for the prompt
  const dailyNotesStr = context.dailyNotes
    .map((d) => `### ${d.date}${d.mood ? ` (${d.mood})` : ""}\n${d.content}`)
    .join("\n\n");

  const completedTasksStr = context.completedTasks
    .map((t) => `- ${t.content}${t.project ? ` [${t.project}]` : ""}`)
    .join("\n");

  const capturesStr = context.captures
    .map((c) => `- [${c.type}] ${c.content}`)
    .join("\n");

  const modifiedNotesStr = context.activeNotes
    .map((n) => `- ${n.title} (${n.type})${n.project ? ` [${n.project}]` : ""} - ${n.wordCount} words`)
    .join("\n");

  const pendingTasksStr = context.pendingTasks?.length
    ? context.pendingTasks
        .map((t) => {
          const parts = [`- ${t.content}`];
          if (t.project) parts.push(`[${t.project}]`);
          if (t.dueDate) parts.push(`(due: ${t.dueDate})`);
          if (t.status && t.status !== "pending") parts.push(`{${t.status}}`);
          return parts.join(" ");
        })
        .join("\n")
    : "No pending tasks";

  let prevWeekSection = "";
  if (context.previousWeekStats) {
    const p = context.previousWeekStats;
    prevWeekSection = `\nLast Week's Stats (for comparison):\n- Tasks completed: ${p.tasksCompleted}\n- Captures: ${p.capturesCount}\n- Notes worked on: ${p.notesWorkedOn}\n- Daily notes: ${p.dailyNotesCount}\n`;
  }
  if (context.previousFocus) {
    prevWeekSection += `\nLast Week's Stated Focus (evaluate follow-through):\n${context.previousFocus}\n`;
  }

  const prompt = WEEKLY_REVIEW_PROMPT
    .replace("{dailyNotes}", dailyNotesStr || "No daily notes this week")
    .replace("{completedTasks}", completedTasksStr || "No tasks completed")
    .replace("{pendingTasks}", pendingTasksStr)
    .replace("{captures}", capturesStr || "No captures this week")
    .replace("{modifiedNotes}", modifiedNotesStr || "No notes modified")
    + prevWeekSection;

  let weeklySystemPrompt = WEEKLY_REVIEW_SYSTEM_PROMPT;
  if (options?.guardrails) {
    weeklySystemPrompt = `${options.guardrails}\n\n${weeklySystemPrompt}`;
  }

  const review = await complete(prompt, {
    system: weeklySystemPrompt,
    model: MINIMAX_MODEL, // Complex synthesis benefits from M2.5's planning optimization
    maxTokens: 2048,
    temperature: 0.6,
  });

  // Add stats header with optional week-over-week comparison
  let statsHeader = `> **Week ${context.weekNumber} Stats:** ${context.stats.dailyNotesCount} daily notes, ${context.stats.tasksCompleted} tasks completed, ${context.stats.capturesCount} captures, ${context.stats.notesWorkedOn} notes worked on`;

  if (context.previousWeekStats) {
    const prev = context.previousWeekStats;
    const delta = (curr: number, prev: number) => {
      if (prev === 0) return curr > 0 ? "+∞" : "—";
      const pct = Math.round(((curr - prev) / prev) * 100);
      return pct >= 0 ? `+${pct}%` : `${pct}%`;
    };
    statsHeader += `\n> **vs. Last Week:** tasks ${delta(context.stats.tasksCompleted, prev.tasksCompleted)}, captures ${delta(context.stats.capturesCount, prev.capturesCount)}, notes ${delta(context.stats.notesWorkedOn, prev.notesWorkedOn)}`;
  }

  return statsHeader + "\n\n" + review;
}
