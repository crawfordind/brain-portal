/**
 * Contact channel normalization.
 *
 * A channel is how you reach an entity: an email address, a phone number, a
 * social handle, a URL, a postal address. `normalized_value` is what
 * `contact_channels` matches on, and it is what makes inbound resolution work —
 * an email arriving from "Dana@Northwind.COM" has to find the entity stored as
 * "dana@northwind.com".
 *
 * Pure and DB-free on purpose: this is the seam every later intake path
 * (BCC dropbox, calendar attendees, scraped contact pages) depends on, so it is
 * unit-tested in isolation before any of them exist.
 */

export const CHANNEL_KINDS = [
  "email",
  "phone",
  "handle",
  "url",
  "address",
] as const;

export type ChannelKind = (typeof CHANNEL_KINDS)[number];

export function isChannelKind(value: string): value is ChannelKind {
  return (CHANNEL_KINDS as readonly string[]).includes(value);
}

/**
 * Normalize a channel value for matching. Returns "" for input that cannot be
 * used as a key; callers must treat "" as a rejection rather than storing it.
 */
export function normalizeChannelValue(kind: ChannelKind, raw: string): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "";

  switch (kind) {
    case "email":
      return normalizeEmail(trimmed);
    case "phone":
      return normalizePhone(trimmed);
    case "handle":
      return normalizeHandle(trimmed);
    case "url":
      return normalizeUrl(trimmed);
    case "address":
      return normalizeAddress(trimmed);
  }
}

/**
 * Lowercase the whole address and require exactly one "@" with something on
 * both sides.
 *
 * Plus-tags are deliberately NOT stripped. "dana+wholesale@farm.com" and
 * "dana@farm.com" are routinely different routing targets, and collapsing them
 * would merge two contact records that the owner deliberately kept apart —
 * exactly the failure mode this CRM exists to prevent.
 */
function normalizeEmail(value: string): string {
  const lowered = value.toLowerCase().replace(/^mailto:/, "");
  const parts = lowered.split("@");
  if (parts.length !== 2) return "";
  const [local, domain] = parts;
  if (!local || !domain || !domain.includes(".")) return "";
  if (/\s/.test(lowered)) return "";
  return `${local}@${domain}`;
}

/**
 * Reduce to digits, preserving a leading "+". A bare 10-digit number is assumed
 * to be +1 (North America), which is the only assumption this codebase can
 * safely make about its user's contacts; an 11-digit number starting with 1 is
 * treated the same way.
 */
function normalizePhone(value: string): string {
  const hadPlus = value.trimStart().startsWith("+");
  const digits = value.replace(/\D/g, "");
  if (digits.length < 7) return "";

  if (hadPlus) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

/** Lowercase, drop a leading "@", drop a surrounding URL if one was pasted. */
function normalizeHandle(value: string): string {
  let handle = value.toLowerCase();
  const asUrl = handle.match(
    /^(?:https?:\/\/)?(?:www\.)?[a-z0-9.-]+\.[a-z]{2,}\/(@?[a-z0-9._-]+)\/?$/
  );
  if (asUrl) handle = asUrl[1];
  handle = handle.replace(/^@+/, "");
  if (!/^[a-z0-9._-]+$/.test(handle)) return "";
  return handle;
}

/** Drop scheme, "www.", trailing slash, and any fragment. Lowercase the host. */
function normalizeUrl(value: string): string {
  const withoutScheme = value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  const withoutFragment = withoutScheme.split("#")[0];
  const slash = withoutFragment.indexOf("/");
  const host = (slash === -1 ? withoutFragment : withoutFragment.slice(0, slash))
    .toLowerCase()
    .replace(/^www\./, "");
  const path = slash === -1 ? "" : withoutFragment.slice(slash);
  if (!host || !host.includes(".")) return "";
  return `${host}${path}`.replace(/\/+$/, "");
}

/**
 * Collapse whitespace and lowercase. Address matching is advisory only — two
 * spellings of one street will not collapse, and that is accepted rather than
 * papered over with fuzzy matching that would merge neighbours.
 */
function normalizeAddress(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}
