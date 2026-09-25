/**
 * Touch points found in the user's own writing.
 *
 * "Had coffee with Dana from Northwind" is two things at once: a mention of
 * Dana and Northwind (an `entity_mentions` row, which the entity layer already
 * records) and a *touch* with them (an `interactions` row, which nothing wrote
 * unless the user logged it by hand). The extractor is asked for both in one
 * call; this module decides which of the touches it reports are real enough to
 * store.
 *
 * Pure and DB-free, for the same reason `dedup.ts` is: the rules here are the
 * ones that can be wrong in ways a spot check will not reveal (a plan stored as
 * a touch, a touch attached to a place, one meeting stored four times), so they
 * are unit-tested against fixed inputs.
 */

import type { InteractionChannel } from "@/lib/db/schema";
import {
  cleanEntityName,
  normalizeEntityKey,
  type EntityType,
} from "@/lib/entities/resolve";

/** Channels the extractor may name. `note` is deliberately absent: it means "logged by hand". */
export const TOUCH_CHANNELS: readonly InteractionChannel[] = [
  "email",
  "call",
  "sms",
  "dm",
  "meeting",
  "event",
  "other",
];

/** Only a person or an organization can be on the other end of a touch. */
const TOUCHABLE_TYPES: readonly EntityType[] = ["person", "org"];

/** One source rarely describes more than a handful of genuine touches. */
export const MAX_TOUCHES_PER_SOURCE = 8;

const MAX_SUMMARY_LENGTH = 140;

export interface RawTouch {
  name?: unknown;
  channel?: unknown;
  direction?: unknown;
  date?: unknown;
  summary?: unknown;
}

export interface TouchCandidateEntity {
  key: string;
  name: string;
  type: EntityType;
}

export interface NormalizedTouch {
  /** Normalized entity key, matching an extracted entity. */
  key: string;
  channel: InteractionChannel;
  direction: "in" | "out";
  /** Calendar day the touch happened, YYYY-MM-DD. */
  day: string;
  summary: string | null;
}

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar day in YYYY-MM-DD form (rejects 2026-02-30). */
export function isValidDay(value: string): boolean {
  const m = DAY_PATTERN.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === mo - 1 &&
    date.getUTCDate() === d
  );
}

/**
 * Keep the touches worth storing.
 *
 * - The name must match an extracted **person or org**. A touch with a place or
 *   a product is not a conversation, and a name the extractor did not also
 *   return as an entity has no contact row to attach to.
 * - A date **after** the source's own day is a plan ("meeting Dana on
 *   Tuesday"), not a touch, and is dropped. A missing or malformed date means
 *   the source's day, which is what "met Dana today" almost always means.
 * - One touch per contact per source. A note describing a long meeting with
 *   Dana is one touch, however many sentences it spends on her.
 */
export function normalizeTouches(
  raw: unknown,
  opts: {
    entities: TouchCandidateEntity[];
    referenceDay: string;
    max?: number;
  }
): NormalizedTouch[] {
  if (!Array.isArray(raw)) return [];

  const touchable = new Map<string, TouchCandidateEntity>();
  for (const e of opts.entities) {
    if (TOUCHABLE_TYPES.includes(e.type)) touchable.set(e.key, e);
  }
  if (touchable.size === 0) return [];

  const max = opts.max ?? MAX_TOUCHES_PER_SOURCE;
  const seen = new Set<string>();
  const out: NormalizedTouch[] = [];

  for (const item of raw as RawTouch[]) {
    if (out.length >= max) break;
    if (!item || typeof item.name !== "string") continue;

    const key = normalizeEntityKey(cleanEntityName(item.name));
    if (!key || !touchable.has(key) || seen.has(key)) continue;

    const day =
      typeof item.date === "string" && isValidDay(item.date.trim())
        ? item.date.trim()
        : opts.referenceDay;
    // Plain string comparison is correct for zero-padded YYYY-MM-DD.
    if (day > opts.referenceDay) continue;

    seen.add(key);
    out.push({
      key,
      channel: normalizeChannel(item.channel),
      direction: item.direction === "in" ? "in" : "out",
      day,
      summary: normalizeSummary(item.summary),
    });
  }

  return out;
}

function normalizeChannel(value: unknown): InteractionChannel {
  const v = typeof value === "string" ? value.toLowerCase().trim() : "";
  return (TOUCH_CHANNELS as readonly string[]).includes(v)
    ? (v as InteractionChannel)
    : "other";
}

function normalizeSummary(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  return clean.length > MAX_SUMMARY_LENGTH
    ? `${clean.slice(0, MAX_SUMMARY_LENGTH - 1).trimEnd()}…`
    : clean;
}

/**
 * The provider-style id an extracted touch is stored under.
 *
 * `buildInteractionDedupKey` turns it into `{channel}:auto:{entity}:{day}`, so
 * a touch is one row per contact, per channel, per day, **whichever source
 * described it**. That is what collapses the four captures written minutes
 * apart about one meeting into one touch, and what keeps a re-edited note from
 * adding a second row because the model worded its summary differently. The
 * subject is deliberately not part of the key for exactly that reason.
 */
export function autoTouchExternalId(entityId: string, day: string): string {
  return `auto:${entityId}:${day}`;
}

/** Midday UTC on the touch's day: displays as that same day almost everywhere. */
export function touchOccurredAt(day: string): string {
  return `${day}T12:00:00.000Z`;
}

/**
 * The calendar day an instant falls on for the user.
 *
 * "Met Dana today", written at 9pm in California, is already tomorrow in UTC.
 * An unknown or invalid zone falls back to UTC rather than throwing, so a bad
 * preference row cannot drop a touch.
 */
export function localDay(instant: Date, timeZone?: string | null): string {
  if (Number.isNaN(instant.getTime())) return "";
  if (timeZone) {
    try {
      // en-CA formats as YYYY-MM-DD.
      return new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(instant);
    } catch {
      // fall through to UTC
    }
  }
  return instant.toISOString().slice(0, 10);
}

/* -------------------------------------------------------------------------- */
/* What is worth reading for contacts at all                                   */
/* -------------------------------------------------------------------------- */

/**
 * Notes written by the app itself about the user's other notes. A weekly
 * review restating "you met Dana on Monday" would log Monday's touch a second
 * time and credit the review as its source.
 */
const GENERATED_NOTE_TYPES = new Set(["weekly", "insight", "monthly_journal"]);

/**
 * Writers whose output is about the world rather than the user's own
 * conversations. An agent researching suppliers names twenty companies the
 * user has never spoken to; they do not belong in the Rolodex.
 */
const NON_PERSONAL_ACTORS = new Set(["agent", "skill"]);

export interface ContactSourceInput {
  entityType: "note" | "capture";
  noteType?: string | null;
  captureType?: string | null;
  sourceActor?: string | null;
}

/**
 * Should this row be read for new contacts and touch points?
 *
 * NULL `source_actor` is the user typing (see `src/lib/provenance/types.ts`),
 * and an MCP key or an import is the user's own words arriving another way.
 */
export function shouldExtractContacts(input: ContactSourceInput): boolean {
  if (input.sourceActor && NON_PERSONAL_ACTORS.has(input.sourceActor)) {
    return false;
  }
  if (input.entityType === "note") {
    return !GENERATED_NOTE_TYPES.has(input.noteType ?? "note");
  }
  // A link capture is a URL; its page is somebody else's writing.
  return input.captureType !== "link";
}
