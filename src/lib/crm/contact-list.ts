/**
 * What a dense contact row needs to know, computed without a DOM.
 *
 * The Rolodex used to render every contact as a stacked card — a wrapping row
 * of badges, then a second wrapping row of badges, then a row of metadata —
 * which is three or four contacts per phone screen, almost all of it chrome.
 * The Android Contacts model is the right one: a single-line list you read by
 * scrolling, an avatar to land the eye, one supporting line, and sections you
 * can skim by letter.
 *
 * Everything here is pure, for the same reason `src/lib/stream/grouping.ts` is:
 * bucketing, initials, the avatar's colour and the "which status is this
 * contact in" reduction are the parts that can be wrong in ways a screenshot
 * will not reveal, so they are unit-tested against fixed inputs instead of
 * being inspected by eye.
 */

import { parseDbTimestamp } from "@/lib/stream/grouping";

/** The slice of `ContactListItem` this module needs. Deliberately structural. */
export interface ContactChannelSummary {
  kind: string;
  value: string;
  is_primary: number;
}

export interface ContactStatusInput {
  resolution: "confirmed" | "unresolved";
  needsReview: boolean;
  compartments: string[];
}

/* -------------------------------------------------------------------------- */
/* Sections                                                                    */
/* -------------------------------------------------------------------------- */

/** The bucket a non-letter initial lands in, and the heading it renders under. */
export const OTHER_SECTION_LETTER = "#";

/**
 * The letter a name files under.
 *
 * Diacritics are folded first, so "Ángela" files under A rather than in the
 * junk bucket — a contact the user can see but cannot find under any letter is
 * worse than no sections at all. Anything that is still not A-Z (a digit, an
 * emoji, a bare "+44 number" placeholder) goes to `#`.
 */
export function sectionLetterFor(name: string): string {
  const first = foldDiacritics(name.trim()).charAt(0).toUpperCase();
  return first >= "A" && first <= "Z" ? first : OTHER_SECTION_LETTER;
}

export interface ContactSection<T> {
  letter: string;
  contacts: T[];
}

/**
 * Group contacts into alphabetical sections, A-Z then `#`.
 *
 * The list arrives from the API ordered by mention count, which is the right
 * order for "who matters" and the wrong order for "find Dana" — an alphabetical
 * list is the one a person can scroll without reading every row. Sorting
 * happens here rather than in SQL because the sections and their order have to
 * agree with it exactly, and because the same endpoint feeds callers that want
 * the ranked order.
 *
 * Empty sections are never emitted, and a name that sorts equal keeps its
 * incoming relative order (`Array.prototype.sort` is stable).
 */
export function groupContactsByLetter<T>(
  contacts: T[],
  getName: (contact: T) => string
): ContactSection<T>[] {
  const sorted = [...contacts].sort((a, b) =>
    getName(a).localeCompare(getName(b), undefined, {
      sensitivity: "base",
      numeric: true,
    })
  );

  const byLetter = new Map<string, T[]>();
  for (const contact of sorted) {
    const letter = sectionLetterFor(getName(contact));
    const bucket = byLetter.get(letter);
    if (bucket) bucket.push(contact);
    else byLetter.set(letter, [contact]);
  }

  const letters = [...byLetter.keys()].sort(compareSectionLetters);
  return letters.map((letter) => ({
    letter,
    contacts: byLetter.get(letter) ?? [],
  }));
}

/** A-Z in order, `#` last — the same place Android and iOS put it. */
function compareSectionLetters(a: string, b: string): number {
  if (a === b) return 0;
  if (a === OTHER_SECTION_LETTER) return 1;
  if (b === OTHER_SECTION_LETTER) return -1;
  return a < b ? -1 : 1;
}

/* -------------------------------------------------------------------------- */
/* Avatar                                                                      */
/* -------------------------------------------------------------------------- */

// Trailing tokens that say what kind of company something is rather than which
// company it is. "Northwind Farms Ltd" should initial as NF, not NL.
const SUFFIX_TOKENS = new Set([
  "ltd",
  "limited",
  "inc",
  "incorporated",
  "llc",
  "llp",
  "plc",
  "co",
  "corp",
  "corporation",
  "gmbh",
  "bv",
  "sa",
  "ag",
  "pty",
  "group",
  "holdings",
  "sons",
]);

/**
 * One or two characters to stand in for a face.
 *
 * Two words give two initials; one word gives one, because "NO" for "Northwind"
 * reads as an abbreviation the user has never seen. Returns "?" rather than an
 * empty string for a nameless row, so the circle is never a blank hole.
 */
export function initialsFor(name: string): string {
  const words = foldDiacritics(name)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

  const meaningful = words.filter(
    (word) => !SUFFIX_TOKENS.has(word.toLowerCase())
  );
  const parts = meaningful.length > 0 ? meaningful : words;

  const first = parts.at(0);
  const last = parts.at(-1);
  if (!first || !last) return "?";
  if (parts.length === 1) return first.charAt(0).toUpperCase();

  return (first.charAt(0) + last.charAt(0)).toUpperCase();
}

/** How many avatar tones exist. They map onto the `--chart-N` design tokens. */
export const AVATAR_TONE_COUNT = 5;

/**
 * Pick an avatar tone, 1-based, from a stable seed.
 *
 * Deterministic on purpose: the caller seeds with the entity id, so a contact's
 * colour survives a re-render, a reload, a rename and a re-sort. A random or
 * index-derived colour would make the list shimmer on every fetch and destroy
 * the one thing the colour is for — recognising a row you have seen before.
 *
 * FNV-1a, because it is four lines and spreads short strings well; nothing here
 * depends on it being cryptographic.
 */
export function avatarToneFor(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return (hash % AVATAR_TONE_COUNT) + 1;
}

/* -------------------------------------------------------------------------- */
/* Supporting line                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The one channel worth putting on a row.
 *
 * `is_primary` wins; after that an email beats a phone number, because it is
 * the one a person recognises at a glance. Everything else is a tiebreak on the
 * order the API already returned.
 */
export function primaryChannelFor<T extends ContactChannelSummary>(
  channels: T[]
): T | null {
  const rank = (channel: T) =>
    (channel.is_primary ? 0 : 4) +
    (channel.kind === "email" ? 0 : channel.kind === "phone" ? 1 : 2);

  let best: T | null = null;
  for (const channel of channels) {
    if (!best || rank(channel) < rank(best)) best = channel;
  }
  return best;
}

/**
 * How long ago the last real touch was, short enough to end a 56px row.
 *
 * Relative and unit-suffixed rather than a date: "3d" answers "is this contact
 * going cold?", which is the only question the list is being asked, in a third
 * of the width of "2026-09-15". Days are counted between local calendar
 * midnights so something logged at 23:50 reads as "yesterday" at 00:10 rather
 * than "today", matching how the stream buckets.
 *
 * Returns null when there is nothing to say, so the caller renders nothing
 * rather than a dash.
 */
export function lastTouchLabel(
  raw: string | null | undefined,
  now: Date
): string | null {
  const when = parseDbTimestamp(raw);
  if (!when) return null;

  const days = Math.round(
    (startOfDay(now).getTime() - startOfDay(when).getTime()) / 86_400_000
  );

  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

function startOfDay(date: Date): Date {
  const copy = new Date(date.getTime());
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/** The word for an entity type, for the row's accessible name. */
export function entityTypeLabel(entityType: string): string {
  if (entityType === "person") return "Person";
  if (entityType === "org") return "Organisation";
  if (!entityType) return "Contact";
  return entityType.charAt(0).toUpperCase() + entityType.slice(1);
}

/* -------------------------------------------------------------------------- */
/* Status                                                                      */
/* -------------------------------------------------------------------------- */

export type ContactStatusKind = "unresolved" | "duplicate" | "restricted";

export interface ContactStatus {
  kind: ContactStatusKind;
  /** Shown when there is room for it, and always in the accessible name. */
  label: string;
  /** The specifics, when the label alone would hide them. */
  detail?: string;
}

/**
 * Every status a contact is in, most consequential first.
 *
 * These are decisions waiting on a human — is this a real contact, is it a
 * duplicate of one I already have, is it something I agreed to keep in one
 * compartment — so none of them may quietly vanish in the name of density. A
 * dense row earns its height by dropping *decoration*, not by dropping the
 * three facts that could make the row wrong.
 *
 * Most contacts return an empty array, which is what makes rendering all of
 * them affordable: the cluster costs nothing on the common row.
 */
export function contactStatuses(input: ContactStatusInput): ContactStatus[] {
  const statuses: ContactStatus[] = [];

  if (input.resolution === "unresolved") {
    statuses.push({
      kind: "unresolved",
      label: "Unresolved",
      detail: "Captured without a confirmed identity",
    });
  }

  if (input.needsReview) {
    statuses.push({ kind: "duplicate", label: "Possible duplicate" });
  }

  // `public` is the documented default, so it carries no information and would
  // otherwise brand every contact in the list as restricted.
  const restricted = input.compartments.filter(
    (compartment) => compartment && compartment.toLowerCase() !== "public"
  );
  if (restricted.length > 0) {
    statuses.push({
      kind: "restricted",
      label: "Restricted",
      detail: restricted.join(", "),
    });
  }

  return statuses;
}

/**
 * The single status to lead with when only one will fit.
 *
 * Severity order is the order `contactStatuses` returns: an unresolved contact
 * is not yet a contact, a duplicate corrupts counts until it is merged, and a
 * compartment is advisory in Phase 0.
 */
export function primaryContactStatus(
  input: ContactStatusInput
): ContactStatus | null {
  return contactStatuses(input).at(0) ?? null;
}

/* -------------------------------------------------------------------------- */

/**
 * Drop combining marks so "Ángela" and "Angela" sort and file together.
 * `normalize` is available in every runtime this app targets.
 */
function foldDiacritics(value: string): string {
  return value.normalize("NFD").replace(/\p{M}+/gu, "");
}
