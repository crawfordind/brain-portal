/**
 * AI usage: what each model call was for, which model ran it, whose key paid,
 * and how many tokens it took.
 *
 * Imports nothing, so the Settings panel, the routes, the standalone MCP
 * server and the tests share it (same reason as `credentials/types.ts`).
 */

export type UsageProvider = "openrouter" | "openai" | "anthropic" | "chatgpt";
export type UsageKind = "chat" | "stream" | "vision" | "embedding";

export interface UsageTokens {
  inputTokens: number;
  outputTokens: number;
}

/** One model call, as recorded. */
export interface AiUsageEvent {
  userId: string;
  provider: UsageProvider;
  model: string;
  /** "user": the account's own key. "server": the operator's key. */
  source: "user" | "server";
  kind: UsageKind;
  /** The job ("fast", "deep", …) when the caller named one. */
  slot: string | null;
  /** What the call was for, in words: "Chat", "Note summary", … */
  purpose: string;
  /** The prompt as sent, trimmed to `PROMPT_PREVIEW_CHARS`. */
  prompt: string;
  inputTokens: number;
  outputTokens: number;
  status: "ok" | "error";
  error: string | null;
  durationMs: number;
}

/** Enough of a prompt to see what was asked, without keeping whole notes twice. */
export const PROMPT_PREVIEW_CHARS = 4000;

/** Recent calls kept per account; totals are kept forever. */
export const MAX_EVENTS_PER_USER = 500;
export const EVENT_RETENTION_DAYS = 30;

/** What Settings shows per model. */
export interface AiUsageTotal {
  provider: UsageProvider;
  model: string;
  source: "user" | "server";
  calls: number;
  inputTokens: number;
  outputTokens: number;
  firstUsedAt: string;
  lastUsedAt: string;
}

export interface AiUsageEventView {
  id: string;
  createdAt: string;
  provider: UsageProvider;
  model: string;
  source: "user" | "server";
  kind: UsageKind;
  slot: string | null;
  purpose: string;
  prompt: string;
  inputTokens: number;
  outputTokens: number;
  status: "ok" | "error";
  error: string | null;
  durationMs: number;
}

export interface AiUsageReport {
  /** False when the usage tables have not been created on this server yet. */
  available: boolean;
  totals: AiUsageTotal[];
  recent: AiUsageEventView[];
}

interface PromptMessage {
  role: string;
  content?: unknown;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      const p = part as { type?: string; text?: string };
      if (p.type === "text" && typeof p.text === "string") return p.text;
      if (p.type === "image_url" || p.type === "image") return "[image]";
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

/**
 * The prompt as a person would read it: each message labelled with its role,
 * images named rather than inlined, and long prompts cut in the middle so the
 * instructions at the top and the question at the bottom both survive.
 */
export function formatPromptPreview(messages: PromptMessage[], limit = PROMPT_PREVIEW_CHARS): string {
  const text = messages
    .map((m) => {
      const body = textOf(m.content).trim();
      return body ? `[${m.role}]\n${body}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
  if (text.length <= limit) return text;
  const head = Math.floor(limit * 0.6);
  const tail = limit - head - 40;
  return `${text.slice(0, head)}\n\n… ${text.length - head - tail} characters left out …\n\n${text.slice(-tail)}`;
}

/** Whole numbers only; providers sometimes omit a count. */
export function tokenCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

/** "1.2M", "34.5k", "812". */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

/** Purpose labels for the slots, used when a caller names a job but not a purpose. */
export const SLOT_PURPOSE: Record<string, string> = {
  fast: "Quick AI task",
  deep: "In-depth analysis",
  agent: "Delegated task",
  vision: "Image reading",
  embedding: "Search indexing",
  chat: "Chat",
};

const JOB_PURPOSE: Record<string, string> = {
  generate_embedding: "Search indexing",
  generate_summary: "Note summary",
  generate_tags: "Note tags",
  find_connections: "Note connections",
  "extract-interactions": "Contacts from notes",
  "link-scrape-and-embed": "Saved link indexing",
  extract_tasks: "Tasks from notes",
  scan_tasks: "Tasks from notes",
  generate_description: "Attachment description",
};

/** A background job's operation, as a person would name it. */
export function jobPurpose(operation: string): string {
  if (JOB_PURPOSE[operation]) return JOB_PURPOSE[operation];
  const words = operation.replace(/[-_]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "Background job";
}
