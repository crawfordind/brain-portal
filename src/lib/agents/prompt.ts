/**
 * Prompt-safety helpers shared by anything that hands Brain Portal content to
 * an agent. Pure, no imports.
 */

/**
 * Structural tags a task envelope uses to separate instructions from data.
 * Content that contains one is defanged with full-width brackets, so a note
 * cannot close `<brain_portal_context>` and append instructions of its own.
 */
const PROMPT_STRUCTURAL_TAGS =
  /(<\/?(?:role|content|context|output_requirements|original_content|previous_output|feedback|revision_instructions|source_entity|annotations|brain_portal_context|brain_portal_task|instruction|attached_note|project|guardrails|urls)(?:\s[^>]*)?>)/gi;

export function escapePromptContent(text: string | null | undefined): string {
  if (!text) return "";
  return text.replace(PROMPT_STRUCTURAL_TAGS, (match) =>
    match.replace(/</g, "＜").replace(/>/g, "＞")
  );
}

/** Cut to `max` characters, saying so, so the reader never mistakes a cut for the end. */
export function truncateForPrompt(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n[… truncated, ${text.length - max} more characters. Read the full record over MCP if you need it.]`;
}
