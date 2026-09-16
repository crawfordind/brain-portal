/**
 * Interaction deduplication.
 *
 * `entity_mentions` is idempotent because a mention is keyed by its source row:
 * UNIQUE(entity_id, source_type, source_id). Interactions cannot use that key,
 * because four separate captures written minutes apart are four distinct
 * sources describing ONE meeting. Keying on the source would admit all four —
 * which is exactly the duplication observed in real capture data.
 *
 * So an interaction carries its own natural key, derived from what actually
 * makes two touches the same touch.
 *
 * Pure and DB-free: the same key must be computable by the API route, by a
 * future BCC-dropbox parser, and by a calendar poller, and all three must
 * agree.
 */

/** Fields that participate in the natural key. */
export interface DedupInput {
  channel: string;
  /** ISO-ish timestamp. Only its calendar day is used in the fallback key. */
  occurredAt: string;
  entityId?: string | null;
  subject?: string | null;
  /**
   * A provider-assigned identifier that is already unique: an RFC 822
   * Message-ID for email, an iCal UID for a calendar event. When present it
   * wins outright, because it is exact and cheap.
   */
  externalId?: string | null;
}

/**
 * Build the value stored in `interactions.dedup_key`, unique per user.
 *
 * Two strategies, in precedence order:
 *
 * 1. `externalId` present -> "{channel}:{externalId}". Exact.
 * 2. Otherwise -> "{channel}:{entityId}:{YYYY-MM-DD}:{subject-slug}".
 *
 * The fallback buckets by DAY rather than timestamp. That is the deliberate
 * choice that collapses four "meeting with Dana Okonkwo" rows logged minutes
 * apart into one, while still admitting two genuinely different conversations
 * on the same day, because their subjects differ.
 */
export function buildInteractionDedupKey(input: DedupInput): string {
  const channel = slug(input.channel) || "other";

  const external = (input.externalId ?? "").trim();
  if (external) {
    return `${channel}:${external.toLowerCase()}`;
  }

  const entity = (input.entityId ?? "").trim() || "unknown";
  const day = toDayBucket(input.occurredAt);
  const subject = slug(input.subject ?? "") || "untitled";

  return `${channel}:${entity}:${day}:${subject}`;
}

/**
 * Extract the calendar day. Anything unparseable degrades to "undated" rather
 * than throwing, so a malformed timestamp from an external feed cannot drop the
 * interaction entirely.
 */
export function toDayBucket(occurredAt: string): string {
  const raw = (occurredAt ?? "").trim();
  if (!raw) return "undated";

  const isoPrefix = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoPrefix) return isoPrefix[1];

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "undated";
  return parsed.toISOString().slice(0, 10);
}

/**
 * Lowercase, strip everything that is not alphanumeric, collapse to single
 * hyphens, and cap the length so one long email subject cannot dominate the
 * key. Mirrors the spirit of normalizeEntityKey: aggressive, and stable across
 * the punctuation noise that mail clients add.
 */
function slug(value: string, max = 60): string {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
}
