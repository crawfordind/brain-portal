/**
 * Contacts and touch points, read out of what the user wrote.
 *
 * Phase 0 built the contact layer on the entity graph "so contacts are
 * populated by notes the user already wrote instead of by data entry", but the
 * only thing that ever read notes for entities was `POST /api/entities/extract`,
 * a button. Nothing logged a touch unless the user or an agent called
 * `log_interaction`. This is the background half: the `extract-interactions`
 * queue job runs it for every note and capture the sweeper hands it (see
 * `src/lib/processing/sweep.ts`).
 *
 * New people and organizations go through `ingestExtractedEntities`, and so
 * through the same merge gate as every other write path. Touches go through
 * `logInteraction`, keyed so that one meeting described in four captures is
 * one touch (see `autoTouchExternalId`).
 */

import { queryOne } from "@/lib/db/client";
import { extractKnowledge } from "@/lib/entities/extractor";
import { ingestExtractedEntities } from "@/lib/entities/store";
import { parseDbTimestamp } from "@/lib/stream/grouping";
import { logInteraction } from "./interactions";
import {
  autoTouchExternalId,
  localDay,
  normalizeTouches,
  touchOccurredAt,
} from "./touches";

export interface ContactExtractionResult {
  entitiesFound: number;
  mentionsAdded: number;
  touchesFound: number;
  /** Touches that were new. A touch another source already recorded is not counted. */
  touchesLogged: number;
}

const EMPTY: ContactExtractionResult = {
  entitiesFound: 0,
  mentionsAdded: 0,
  touchesFound: 0,
  touchesLogged: 0,
};

export async function extractContactsFromText(params: {
  userId: string;
  sourceType: "note" | "capture";
  sourceId: string;
  title?: string | null;
  text: string;
  /** YYYY-MM-DD the source was written, in the user's own timezone. */
  referenceDay: string;
}): Promise<ContactExtractionResult> {
  const { userId, sourceType, sourceId, referenceDay } = params;
  const title = params.title?.trim() || "";
  const combined = title ? `${title}\n\n${params.text}` : params.text;

  const knowledge = await extractKnowledge(combined, referenceDay);
  if (knowledge.entities.length === 0) return EMPTY;

  const { result, entityIdsByKey } = await ingestExtractedEntities(
    { userId, sourceType, sourceId, occurredAt: referenceDay },
    knowledge.entities
  );

  const touches = normalizeTouches(knowledge.touches, {
    entities: knowledge.entities,
    referenceDay,
  });

  let touchesLogged = 0;
  for (const touch of touches) {
    const entityId = entityIdsByKey.get(touch.key);
    if (!entityId) continue;

    const { deduped } = await logInteraction(userId, {
      entityId,
      channel: touch.channel,
      direction: touch.direction,
      occurredAt: touchOccurredAt(touch.day),
      subject:
        touch.summary ??
        (title ? `Mentioned in "${title.slice(0, 100)}"` : null),
      sourceType,
      sourceId,
      externalId: autoTouchExternalId(entityId, touch.day),
      // Marks the row as inferred, so it can be told apart from a touch the
      // user or an agent logged deliberately.
      metadata: { extracted: true },
    });
    if (!deduped) touchesLogged++;
  }

  return {
    entitiesFound: result.entitiesFound,
    mentionsAdded: result.mentionsAdded,
    touchesFound: touches.length,
    touchesLogged,
  };
}

/* -------------------------------------------------------------------------- */
/* Loading a source                                                            */
/* -------------------------------------------------------------------------- */

async function userTimeZone(userId: string): Promise<string | null> {
  try {
    const row = await queryOne<{ timezone: string | null }>(
      `SELECT timezone FROM notification_preferences WHERE user_id = ?`,
      [userId]
    );
    return row?.timezone ?? null;
  } catch {
    return null;
  }
}

/**
 * Load a note or capture and extract from it. Returns null when the row is
 * gone (deleted while queued), which is not a failure worth retrying.
 */
export async function extractContactsFromSource(
  userId: string,
  sourceType: "note" | "capture",
  sourceId: string
): Promise<ContactExtractionResult | null> {
  let title: string | null = null;
  let text: string;
  let writtenAt: string | null;
  let dailyDate: string | null = null;

  if (sourceType === "note") {
    const note = await queryOne<{
      title: string;
      content: string;
      content_plain: string | null;
      created_at: string;
      daily_date: string | null;
    }>(
      `SELECT n.title, n.content, n.content_plain, n.created_at, dn.date AS daily_date
       FROM notes n
       LEFT JOIN daily_notes dn ON dn.note_id = n.id
       WHERE n.id = ? AND n.user_id = ?`,
      [sourceId, userId]
    );
    if (!note) return null;
    title = note.title;
    // `content` is HTML; `content_plain` has the tags stripped.
    text = note.content_plain?.trim() || note.content || "";
    writtenAt = note.created_at;
    dailyDate = note.daily_date;
  } else {
    const capture = await queryOne<{
      content: string;
      captured_at: string | null;
      created_at: string;
    }>(
      `SELECT content, captured_at, created_at FROM captures WHERE id = ? AND user_id = ?`,
      [sourceId, userId]
    );
    if (!capture) return null;
    text = capture.content || "";
    writtenAt = capture.captured_at || capture.created_at;
  }

  // A daily note's own date wins: it is the day the user was writing about,
  // even when they filled it in the next morning.
  const referenceDay =
    (dailyDate && /^\d{4}-\d{2}-\d{2}$/.test(dailyDate) ? dailyDate : null) ??
    localDay(parseDbTimestamp(writtenAt) ?? new Date(), await userTimeZone(userId));

  return extractContactsFromText({
    userId,
    sourceType,
    sourceId,
    title,
    text,
    referenceDay,
  });
}
