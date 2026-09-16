/**
 * Guardrails Service
 * CRUD operations for user guardrails — the user's AI interaction profile.
 */

import { queryOne } from "@/lib/db/client";
import { db } from "@/lib/db/client";
import type { InValue } from "@libsql/client";

export interface UserGuardrails {
  id: string;
  user_id: string;
  personal_context: string;
  beliefs: string;
  communication_style: string;
  topics_to_emphasize: string; // JSON array
  topics_to_avoid: string;    // JSON array
  custom_instructions: string;
  learned_context: string;    // JSON object
  interaction_count: number;
  last_evolved_at: string | null;
  evolution_version: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface GuardrailsInput {
  personal_context?: string;
  beliefs?: string;
  communication_style?: string;
  topics_to_emphasize?: string[];
  topics_to_avoid?: string[];
  custom_instructions?: string;
  is_active?: boolean;
}

const DEFAULTS: Omit<UserGuardrails, "id" | "user_id" | "created_at" | "updated_at"> = {
  personal_context: "",
  beliefs: "",
  communication_style: "",
  topics_to_emphasize: "[]",
  topics_to_avoid: "[]",
  custom_instructions: "",
  learned_context: "{}",
  interaction_count: 0,
  last_evolved_at: null,
  evolution_version: 0,
  is_active: 1,
};

/**
 * Get guardrails for a user, returning defaults if none exist
 */
export async function getGuardrails(userId: string): Promise<UserGuardrails> {
  const row = await queryOne<UserGuardrails>(
    "SELECT * FROM user_guardrails WHERE user_id = ?",
    [userId]
  );

  if (row) return row;

  // Return defaults without creating a row (lazy-create on first save)
  return {
    ...DEFAULTS,
    id: "",
    user_id: userId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

const ALLOWED_FIELDS = [
  "personal_context",
  "beliefs",
  "communication_style",
  "topics_to_emphasize",
  "topics_to_avoid",
  "custom_instructions",
  "is_active",
] as const;

/**
 * Update guardrails for a user (upsert)
 */
export async function updateGuardrails(
  userId: string,
  input: GuardrailsInput
): Promise<UserGuardrails> {
  // Check if row exists
  const existing = await queryOne<{ id: string }>(
    "SELECT id FROM user_guardrails WHERE user_id = ?",
    [userId]
  );

  // Build field updates
  const updates: Record<string, unknown> = {};
  for (const field of ALLOWED_FIELDS) {
    const value = input[field as keyof GuardrailsInput];
    if (value === undefined) continue;
    if (field === "topics_to_emphasize" || field === "topics_to_avoid") {
      updates[field] = JSON.stringify(value);
    } else if (field === "is_active") {
      updates[field] = value ? 1 : 0;
    } else {
      updates[field] = value;
    }
  }

  if (existing) {
    // Update existing row
    const setClauses = Object.keys(updates)
      .map((k) => `${k} = ?`)
      .concat("updated_at = datetime('now')");
    const values = Object.values(updates) as InValue[];

    await db.execute({
      sql: `UPDATE user_guardrails SET ${setClauses.join(", ")} WHERE user_id = ?`,
      args: [...values, userId],
    });
  } else {
    // Insert new row
    const fields = Object.keys(updates);
    const placeholders = fields.map(() => "?");
    const values = Object.values(updates) as InValue[];

    await db.execute({
      sql: `INSERT INTO user_guardrails (user_id, ${fields.join(", ")})
            VALUES (?, ${placeholders.join(", ")})`,
      args: [userId, ...values],
    });
  }

  return getGuardrails(userId);
}

/**
 * Increment interaction count (called after LLM completions)
 */
export async function incrementInteractionCount(userId: string): Promise<number> {
  const existing = await queryOne<{ id: string; interaction_count: number }>(
    "SELECT id, interaction_count FROM user_guardrails WHERE user_id = ?",
    [userId]
  );

  if (!existing) return 0;

  const newCount = (existing.interaction_count || 0) + 1;
  await db.execute({
    sql: "UPDATE user_guardrails SET interaction_count = ? WHERE user_id = ?",
    args: [newCount, userId],
  });

  return newCount;
}

/**
 * Update learned context (called by evolution system)
 */
export async function updateLearnedContext(
  userId: string,
  learnedContext: Record<string, unknown>,
  evolutionVersion: number
): Promise<void> {
  await db.execute({
    sql: `UPDATE user_guardrails
          SET learned_context = ?,
              evolution_version = ?,
              last_evolved_at = datetime('now'),
              updated_at = datetime('now')
          WHERE user_id = ?`,
    args: [JSON.stringify(learnedContext), evolutionVersion, userId],
  });
}
