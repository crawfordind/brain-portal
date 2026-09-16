/**
 * Guardrails Compiler
 * Compiles user guardrails into a compact system prompt fragment.
 *
 * Design principle: minimize tokens while maximizing signal.
 * A typical compiled fragment is ~80-150 tokens — cheap to prepend to every call.
 */

import type { UserGuardrails } from "./service";

/**
 * Compile guardrails into a compact prompt fragment for injection.
 * Returns empty string if guardrails are inactive or empty.
 */
export function compileGuardrails(guardrails: UserGuardrails): string {
  if (!guardrails.is_active) return "";

  const lines: string[] = [];

  // Personal context — who the user is
  if (guardrails.personal_context.trim()) {
    lines.push(`User: ${guardrails.personal_context.trim()}`);
  }

  // Beliefs and values
  if (guardrails.beliefs.trim()) {
    lines.push(`Values: ${guardrails.beliefs.trim()}`);
  }

  // Communication style
  if (guardrails.communication_style.trim()) {
    lines.push(`Style: ${guardrails.communication_style.trim()}`);
  }

  // Topics to emphasize
  const emphasize = safeParseArray(guardrails.topics_to_emphasize);
  if (emphasize.length > 0) {
    lines.push(`Emphasize: ${emphasize.join(", ")}`);
  }

  // Topics to avoid
  const avoid = safeParseArray(guardrails.topics_to_avoid);
  if (avoid.length > 0) {
    lines.push(`Avoid: ${avoid.join(", ")}`);
  }

  // Custom instructions
  if (guardrails.custom_instructions.trim()) {
    lines.push(`Instructions: ${guardrails.custom_instructions.trim()}`);
  }

  // Learned preferences (system-evolved)
  const learned = safeParseObject(guardrails.learned_context);
  const learnedLines = compileLearnedContext(learned);
  if (learnedLines) {
    lines.push(`Learned: ${learnedLines}`);
  }

  if (lines.length === 0) return "";

  return `<user_context>\n${lines.join("\n")}\n</user_context>`;
}

/**
 * Inject compiled guardrails into a system prompt.
 * Prepends the user context block before the existing system prompt.
 */
export function injectGuardrails(systemPrompt: string, compiledGuardrails: string): string {
  if (!compiledGuardrails) return systemPrompt;
  return `${compiledGuardrails}\n\n${systemPrompt}`;
}

/**
 * Compile learned context into a compact string.
 * Learned context is a JSON object with auto-discovered preferences.
 */
function compileLearnedContext(learned: Record<string, unknown>): string {
  const parts: string[] = [];

  if (learned.preferences && typeof learned.preferences === "string") {
    parts.push(learned.preferences);
  }

  if (Array.isArray(learned.patterns) && learned.patterns.length > 0) {
    parts.push(learned.patterns.join("; "));
  }

  if (learned.working_style && typeof learned.working_style === "string") {
    parts.push(learned.working_style);
  }

  return parts.join(". ");
}

function safeParseArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === "string" && s.trim()) : [];
  } catch {
    return [];
  }
}

function safeParseObject(json: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(json);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}
