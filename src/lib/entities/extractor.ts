/**
 * Entity extraction from note/capture text.
 *
 * Thin LLM wrapper — the deterministic cleanup (dedup, normalization, junk
 * filtering) lives in ./resolve and is unit-tested there. `extractEntities`
 * returns [] on any failure so the manual extraction route degrades gracefully.
 * `extractKnowledge`, used by the background pipeline, lets a failed model call
 * throw so the queue records it and retries, instead of marking the note as
 * read when nothing was read.
 */

import { completeJSON } from "@/lib/ai/client";
import { dedupeExtractedEntities, type EntityType } from "./resolve";

export interface ExtractedEntity {
  name: string;
  key: string;
  type: EntityType;
  aliases: string[];
}

const SYSTEM_PROMPT = `You extract named entities from a person's private notes.
Return ONLY real, specific named entities: people, organizations/companies,
places, projects, products, and material inputs (ingredients, supplies,
materials). Do NOT return generic nouns, verbs, dates, quantities, common words,
or the note's own title as an entity. Prefer the fullest proper-name form (e.g.
"Northwind Farms" rather than "Northwind"). Keep the list tight — quality over
quantity.`;

const MAX_TEXT = 6000;

type RawEntity = { name?: string; type?: string };

function cleanRawEntities(raw: unknown): ExtractedEntity[] {
  const list = Array.isArray(raw) ? (raw as RawEntity[]) : [];
  return dedupeExtractedEntities(
    list
      .filter((e): e is { name: string; type?: string } =>
        Boolean(e && typeof e.name === "string")
      )
      .map((e) => ({ name: e.name, type: e.type }))
  );
}

/**
 * Extract and clean entities from text. Returns a deduped, normalized list.
 */
export async function extractEntities(text: string): Promise<ExtractedEntity[]> {
  const trimmed = (text || "").slice(0, MAX_TEXT).trim();
  if (trimmed.length < 20) return [];

  const prompt = `Extract the named entities from the note below.
Return JSON exactly of the form:
{"entities":[{"name":"Proper Name","type":"person|org|place|project|product|input|other"}]}

NOTE:
"""
${trimmed}
"""`;

  try {
    const res = await completeJSON<{
      entities?: { name?: string; type?: string }[];
    }>(prompt, { system: SYSTEM_PROMPT, maxTokens: 512 });

    return cleanRawEntities(res?.entities);
  } catch {
    return [];
  }
}

export interface ExtractedKnowledge {
  entities: ExtractedEntity[];
  /**
   * Unvalidated touch candidates exactly as the model returned them. Run them
   * through `normalizeTouches` (src/lib/crm/touches.ts), which holds the rules
   * for which ones are real.
   */
  touches: unknown[];
}

const TOUCH_SYSTEM_PROMPT = `${SYSTEM_PROMPT}

You also identify TOUCHES: things that actually happened between the note's
author and a specific person or organization — they met, spoke, called,
emailed, messaged, or saw each other at an event. A mere mention is NOT a touch
("Northwind makes good compost"). An intention is NOT a touch ("I should call
Dana"). A plan is NOT a touch ("meeting Dana next Tuesday"). When unsure, leave
it out: a missing touch costs the user a click, a false one misleads them.`;

/**
 * Extract entities and the touches the author had with them, in one call.
 *
 * `referenceDay` (YYYY-MM-DD) is the day the source was written, so the model
 * can resolve "yesterday" or "on Monday". Unlike `extractEntities` this lets a
 * failed model call throw, so the queue records the reason and retries rather
 * than treating "the model was down" as "the note names nobody".
 */
export async function extractKnowledge(
  text: string,
  referenceDay: string
): Promise<ExtractedKnowledge> {
  const trimmed = (text || "").slice(0, MAX_TEXT).trim();
  if (trimmed.length < 20) return { entities: [], touches: [] };

  const prompt = `The note below was written on ${referenceDay}.
Extract its named entities, and any touches the author had with a person or organization.
Return JSON exactly of the form:
{"entities":[{"name":"Proper Name","type":"person|org|place|project|product|input|other"}],
 "touches":[{"name":"the same Proper Name as in entities","channel":"meeting|call|email|sms|dm|event|other","direction":"out if the author reached out or attended, in if they reached the author","date":"YYYY-MM-DD","summary":"one short line on what it was about"}]}
Use "touches":[] when there are none.

NOTE:
"""
${trimmed}
"""`;

  const res = await completeJSON<{ entities?: unknown; touches?: unknown }>(
    prompt,
    { system: TOUCH_SYSTEM_PROMPT, maxTokens: 900 }
  );

  return {
    entities: cleanRawEntities(res?.entities),
    touches: Array.isArray(res?.touches) ? res.touches : [],
  };
}
