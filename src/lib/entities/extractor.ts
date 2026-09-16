/**
 * Entity extraction from note/capture text.
 *
 * Thin LLM wrapper — the deterministic cleanup (dedup, normalization, junk
 * filtering) lives in ./resolve and is unit-tested there. On any failure this
 * returns [] so entity ingestion degrades gracefully rather than throwing.
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

    const raw = Array.isArray(res?.entities) ? res.entities : [];
    return dedupeExtractedEntities(
      raw
        .filter((e): e is { name: string; type?: string } =>
          Boolean(e && typeof e.name === "string")
        )
        .map((e) => ({ name: e.name, type: e.type }))
    );
  } catch {
    return [];
  }
}
