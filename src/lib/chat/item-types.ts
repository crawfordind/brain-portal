/**
 * The item vocabulary, with no imports.
 *
 * Kept apart from `item-context.ts` for the same reason
 * `system-health/types.ts` is kept apart from its index: the loader there
 * reaches for the DB client and the embeddings module, and the embeddings
 * module constructs an OpenAI client at import time. Anything that only needs
 * to name an item — the client hook, the chat sheet, a test — would otherwise
 * drag all of that into the browser bundle.
 */

/** Item types that can be the subject of a chat. */
export const CHAT_ITEM_TYPES = [
  "note",
  "capture",
  "task",
  "reminder",
  "thought",
  "insight",
  "journal",
] as const;

export type ChatItemType = (typeof CHAT_ITEM_TYPES)[number];

export interface ChatItemRef {
  type: ChatItemType;
  id: string;
}

/** `{ type, id }` → the `context_id` string stored on the conversation. */
export function encodeItemRef(ref: ChatItemRef): string {
  return `${ref.type}:${ref.id}`;
}

/**
 * Parse a stored `context_id` back into a ref.
 *
 * Returns null for anything unrecognised — an unknown type, a missing id, or
 * a plain id left over from an older conversation — so a bad value degrades
 * to the general context instead of reaching the database.
 */
export function parseItemRef(contextId: string | null | undefined): ChatItemRef | null {
  if (!contextId) return null;

  // Only the first colon separates the halves, so an id that contains one
  // survives instead of being truncated.
  const separator = contextId.indexOf(":");
  if (separator <= 0) return null;

  const type = contextId.slice(0, separator);
  const id = contextId.slice(separator + 1).trim();
  if (!id) return null;
  if (!(CHAT_ITEM_TYPES as readonly string[]).includes(type)) return null;

  return { type: type as ChatItemType, id };
}
