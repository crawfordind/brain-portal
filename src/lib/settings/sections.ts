/**
 * The settings page's table of contents.
 *
 * Settings used to be one column of fourteen cards, so finding "notifications"
 * meant scrolling past theme pickers, model lists and key managers. They are now
 * sections in named groups: a sidebar on desktop, a list you drill into on a
 * phone. This file is the single description of what those sections are.
 *
 * The address of a section is the URL hash (`/settings#notifications`). Hashes
 * were already how the rest of the app linked here (email footers, the share
 * dialog, the OpenRouter callback), so every existing link keeps landing on the
 * right thing with no change at its source.
 *
 * Imports nothing, so the shell, the tests and anything else can read it.
 */

export const SETTINGS_GROUPS = [
  { id: "account", label: "Account" },
  { id: "preferences", label: "Preferences" },
  { id: "ai", label: "AI" },
  { id: "advanced", label: "Advanced" },
] as const;

export type SettingsGroupId = (typeof SETTINGS_GROUPS)[number]["id"];

export interface SettingsSection {
  id: string;
  group: SettingsGroupId;
  label: string;
  /** One line under the title, and the row's subtitle in the mobile list. */
  description: string;
  /** Extra words a search should match, beyond label and description. */
  keywords: readonly string[];
}

export const SETTINGS_SECTIONS = [
  {
    id: "account",
    group: "account",
    label: "Profile",
    description: "Your sign-in address and this device's session",
    keywords: ["account", "email", "sign out", "log out", "logout", "session"],
  },
  {
    id: "notifications",
    group: "account",
    label: "Notifications",
    description: "Reminders, email alerts, digests, quiet hours and time zone",
    keywords: ["email", "digest", "quiet hours", "timezone", "time zone", "push", "alerts", "reminders", "unsubscribe"],
  },
  {
    id: "sharing",
    group: "account",
    label: "Sharing",
    description: "People you share notes with, saved by name",
    keywords: ["recipients", "work account", "share", "collaborate"],
  },
  {
    id: "appearance",
    group: "preferences",
    label: "Appearance",
    description: "Theme and how dense the stream is",
    keywords: ["theme", "dark mode", "light mode", "color", "colour", "density", "compact", "cozy", "comfortable"],
  },
  {
    id: "editor",
    group: "preferences",
    label: "Editor",
    description: "How writing a note behaves",
    keywords: ["spell check", "spelling", "autosave", "auto-save", "writing", "highlights"],
  },
  {
    id: "voice",
    group: "preferences",
    label: "Voice",
    description: "Language, punctuation and commands for voice capture",
    keywords: ["microphone", "mic", "dictation", "speech", "language", "shortcut", "audio"],
  },
  {
    id: "ai-provider",
    group: "ai",
    label: "AI provider",
    description: "Whose key pays: OpenRouter, OpenAI, Claude or a ChatGPT plan",
    keywords: ["api key", "openrouter", "openai", "claude", "anthropic", "chatgpt", "billing", "fallback", "backup"],
  },
  {
    id: "ai-models",
    group: "ai",
    label: "Models",
    description: "Which model handles each kind of work",
    keywords: ["model", "llm", "embedding", "vision", "fast", "deep", "agent"],
  },
  {
    id: "ai-guardrails",
    group: "ai",
    label: "Personalization",
    description: "Who you are and how AI should respond to you",
    keywords: ["guardrails", "profile", "values", "tone", "instructions", "about me"],
  },
  {
    id: "ai-usage",
    group: "ai",
    label: "Usage",
    description: "Tokens per model and what each recent call sent",
    keywords: ["tokens", "cost", "spend", "prompt", "log", "history"],
  },
  {
    id: "api-access",
    group: "advanced",
    label: "API access",
    description: "Keys for MCP clients and external agents",
    keywords: ["mcp", "api key", "token", "connector", "claude desktop", "integration", "scopes"],
  },
  {
    id: "data",
    group: "advanced",
    label: "Data & export",
    description: "Download your vault, back up as JSON",
    keywords: ["export", "backup", "download", "obsidian", "markdown", "json", "delete"],
  },
] as const satisfies readonly SettingsSection[];

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

/** Where desktop opens when the URL names no section. */
export const DEFAULT_SECTION_ID: SettingsSectionId = "account";

/**
 * Hashes that once pointed at a card on the old page and now live under
 * another name. Links already sent in emails cannot be rewritten.
 */
const LEGACY_ALIASES: Record<string, SettingsSectionId> = {
  "mcp-keys": "api-access",
  "api-keys": "api-access",
  models: "ai-models",
  guardrails: "ai-guardrails",
  "danger-zone": "data",
  export: "data",
};

const BY_ID = new Map<string, SettingsSection>(
  SETTINGS_SECTIONS.map((section) => [section.id, section])
);

/**
 * The section a URL hash names, or null when it names none.
 *
 * Accepts the hash with or without its `#`, ignores case, and returns null for
 * anything unrecognised rather than guessing, so a stale link lands on the
 * section list instead of on the wrong section.
 */
export function resolveSectionId(hash: string | null | undefined): SettingsSectionId | null {
  if (!hash) return null;
  let key: string;
  try {
    key = decodeURIComponent(hash.replace(/^#/, "")).trim().toLowerCase();
  } catch {
    return null; // a malformed escape, e.g. "#%E0"
  }
  if (!key) return null;
  if (BY_ID.has(key)) return key as SettingsSectionId;
  return LEGACY_ALIASES[key] ?? null;
}

export function getSection(id: SettingsSectionId): SettingsSection {
  return BY_ID.get(id)!;
}

/**
 * Sections matching a search, in table-of-contents order.
 *
 * Every word of the query must appear somewhere in the section's label,
 * description or keywords, so "dark" finds Appearance and "email digest" finds
 * Notifications but "email theme" finds nothing. An empty query matches all.
 */
export function searchSections(query: string): SettingsSection[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...SETTINGS_SECTIONS];

  return SETTINGS_SECTIONS.filter((section) => {
    const haystack = [section.label, section.description, ...section.keywords]
      .join(" ")
      .toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/** Sections grouped for display, dropping groups left empty by a search. */
export function groupSections(
  sections: readonly SettingsSection[]
): { id: SettingsGroupId; label: string; sections: SettingsSection[] }[] {
  return SETTINGS_GROUPS.map((group) => ({
    id: group.id,
    label: group.label,
    sections: sections.filter((section) => section.group === group.id),
  })).filter((group) => group.sections.length > 0);
}
