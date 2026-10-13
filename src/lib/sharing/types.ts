/**
 * Note sharing between accounts: the vocabulary and the pure rules.
 *
 * Imports nothing, so the API routes, the MCP tools (which run outside
 * Next.js) and the browser all share one copy of these rules. Same reasoning
 * as `chat/item-types.ts` and `provenance/types.ts`.
 *
 * Two kinds of sharing exist and they are deliberately different things:
 *
 *   - A **public link** (`notes.share_token`) shows a read-only copy of a note
 *     to anyone holding the URL. No account involved.
 *   - An **account share** (`note_shares`) gives another account on this
 *     instance access to the live note, inside the app: it appears under
 *     "Shared with me", opens in the normal note view, and that account's MCP
 *     key can read it. Revoking it removes access at once.
 */

export const NOTE_SHARE_PERMISSIONS = ["view", "edit"] as const;
export type NoteSharePermission = (typeof NOTE_SHARE_PERMISSIONS)[number];

/** What a viewer may do with a note, whichever route gave them access. */
export type NoteRole = "owner" | "editor" | "viewer";

/** How a viewer came to have access to a note. */
export type NoteAccessVia = "owner" | "project" | "share";

/** One account a user has named as a sharing destination ("work" → address). */
export interface SavedRecipient {
  label: string;
  email: string;
}

/** Upper bounds, so a script or a confused agent cannot grow these without limit. */
export const MAX_SHARES_PER_NOTE = 50;
export const MAX_SAVED_RECIPIENTS = 10;
export const MAX_RECIPIENT_LABEL = 40;

export function isNoteSharePermission(value: unknown): value is NoteSharePermission {
  return typeof value === "string" && (NOTE_SHARE_PERMISSIONS as readonly string[]).includes(value);
}

/** Lowercased and trimmed. Addresses are matched case-insensitively everywhere. */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** Deliberately simple: one `@`, something either side, a dot in the domain, no spaces. */
export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) && value.trim().length <= 254;
}

const ROLE_LEVEL: Record<NoteRole, number> = { viewer: 1, editor: 2, owner: 3 };

/** The role an account share grants. */
export function roleForPermission(permission: NoteSharePermission): NoteRole {
  return permission === "edit" ? "editor" : "viewer";
}

/**
 * Combine every route a viewer has to a note into the one role that applies.
 *
 * A note can be reachable twice — the viewer collaborates on its project *and*
 * the owner shared it directly — and the stronger grant wins, so sharing a
 * note "view only" with a project editor never takes their editing away.
 */
export function strongestRole(
  ...grants: Array<{ role: NoteRole; via: NoteAccessVia } | null | undefined>
): { role: NoteRole; via: NoteAccessVia } | null {
  let best: { role: NoteRole; via: NoteAccessVia } | null = null;
  for (const grant of grants) {
    if (!grant) continue;
    if (!best || ROLE_LEVEL[grant.role] > ROLE_LEVEL[best.role]) best = grant;
  }
  return best;
}

export function canEditRole(role: NoteRole): boolean {
  return ROLE_LEVEL[role] >= ROLE_LEVEL.editor;
}

/**
 * Read the saved recipients out of a `users.preferences` blob.
 *
 * Tolerant by design: a corrupt blob or a malformed entry yields fewer
 * recipients, never an exception, because this is read on every MCP share.
 */
export function parseSavedRecipients(preferences: string | null | undefined): SavedRecipient[] {
  if (!preferences) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(preferences);
  } catch {
    return [];
  }
  const list = (parsed as { sharing?: { recipients?: unknown } } | null)?.sharing?.recipients;
  if (!Array.isArray(list)) return [];
  const out: SavedRecipient[] = [];
  for (const entry of list) {
    const label = typeof entry?.label === "string" ? entry.label.trim() : "";
    const email = typeof entry?.email === "string" ? normalizeEmail(entry.email) : "";
    if (label && isValidEmail(email)) out.push({ label, email });
  }
  return out;
}

export type RecipientsValidation =
  | { ok: true; recipients: SavedRecipient[] }
  | { ok: false; error: string };

/** Validate a whole replacement list of saved recipients, as sent by Settings. */
export function validateSavedRecipients(
  input: unknown,
  ownEmail?: string | null
): RecipientsValidation {
  if (!Array.isArray(input)) return { ok: false, error: "recipients must be a list" };
  if (input.length > MAX_SAVED_RECIPIENTS) {
    return { ok: false, error: `At most ${MAX_SAVED_RECIPIENTS} saved recipients` };
  }
  const own = ownEmail ? normalizeEmail(ownEmail) : null;
  const labels = new Set<string>();
  const emails = new Set<string>();
  const recipients: SavedRecipient[] = [];

  for (const entry of input) {
    const label = typeof entry?.label === "string" ? entry.label.trim() : "";
    const rawEmail = typeof entry?.email === "string" ? entry.email : "";
    if (!label) return { ok: false, error: "Every recipient needs a name" };
    if (label.length > MAX_RECIPIENT_LABEL) {
      return { ok: false, error: `"${label.slice(0, 20)}…" is longer than ${MAX_RECIPIENT_LABEL} characters` };
    }
    if (!isValidEmail(rawEmail)) return { ok: false, error: `"${label}" needs a valid email address` };
    const email = normalizeEmail(rawEmail);
    if (own && email === own) return { ok: false, error: "You can't add your own address" };
    const key = label.toLowerCase();
    if (labels.has(key)) return { ok: false, error: `The name "${label}" is used twice` };
    if (emails.has(email)) return { ok: false, error: `${email} is listed twice` };
    labels.add(key);
    emails.add(email);
    recipients.push({ label, email });
  }
  return { ok: true, recipients };
}

export type RecipientResolution =
  | { ok: true; recipient: SavedRecipient }
  | { ok: false; error: string };

/**
 * Match what an agent said ("work", "my work account", "Work", or the address
 * itself) to exactly one saved recipient.
 *
 * Agents may only share with saved recipients. That is the boundary that keeps
 * a prompt-injected agent from sending the user's notes to an address of an
 * attacker's choosing: the list is written by the user, in Settings, and an
 * MCP key cannot change it.
 *
 * Matching is exact on the label or the address (case-insensitive), then a
 * tolerant pass that ignores "my" and "account"/"acct" so that "my work
 * account" finds "Work". Two candidates means no match, never a guess.
 */
export function resolveSavedRecipient(
  saved: SavedRecipient[],
  input: string
): RecipientResolution {
  const raw = input.trim();
  if (!raw) return { ok: false, error: "No recipient given." };

  if (saved.length === 0) {
    return {
      ok: false,
      error:
        "No saved share recipients. The user must add one in Settings → Sharing " +
        "(for example the name \"work\" and that account's email) before notes can be shared from here.",
    };
  }

  const lower = raw.toLowerCase();
  const exact = saved.filter((r) => r.label.toLowerCase() === lower || r.email === lower);
  if (exact.length === 1) return { ok: true, recipient: exact[0] };

  const loose = (s: string) =>
    s
      .toLowerCase()
      .replace(/\b(my|the|account|acct|inbox|email|address)\b/g, " ")
      .replace(/[^a-z0-9@.]+/g, " ")
      .trim();
  const wanted = loose(raw);
  const fuzzy = wanted ? saved.filter((r) => loose(r.label) === wanted) : [];
  if (fuzzy.length === 1) return { ok: true, recipient: fuzzy[0] };

  const names = saved.map((r) => `"${r.label}"`).join(", ");
  return {
    ok: false,
    error: `"${raw}" is not one of the saved share recipients (${names}). Use one of those names, or ask the user to add the recipient in Settings → Sharing.`,
  };
}
