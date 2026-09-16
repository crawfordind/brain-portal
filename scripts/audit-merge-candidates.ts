/**
 * Read-only audit: how many existing entities would the merge gate have flagged?
 *
 * `normalizeEntityKey` strips business suffixes, so "Northwind Farms",
 * "Northwind Holdings" and "Northwind & Sons" all reduce to one key and, under
 * UNIQUE(user_id, normalized_key), the later ones silently attached to the
 * first. That has already happened in existing data, and there is no record of
 * it.
 *
 * This script measures the blast radius before anyone relies on the gate. It
 * reports two things:
 *
 *   1. ALIASES THAT WERE A MANUFACTURED MATCH — an alias whose strict key
 *      differs from its entity's. Each is a merge that rule 5 would now flag
 *      for review instead of applying silently.
 *   2. ENTITIES THAT WOULD NOW COLLIDE — distinct entities sharing a loose key.
 *      These should not exist (the UNIQUE constraint forbids it), so any hit is
 *      a data-integrity finding worth looking at.
 *
 * Writes nothing. Run before enabling the gate on real data, and put the number
 * in the implementation PR.
 *
 * Run with: npx tsx scripts/audit-merge-candidates.ts [user@example.com]
 */

import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

import { query } from "@/lib/db/client";
import {
  normalizeEntityKey,
  normalizeEntityKeyStrict,
} from "@/lib/entities/resolve";

interface EntityRow {
  id: string;
  user_id: string;
  canonical_name: string;
  normalized_key: string;
  entity_type: string;
  mention_count: number;
}

interface AliasRow {
  entity_id: string;
  alias: string;
  canonical_name: string;
  entity_type: string;
}

async function audit() {
  if (!process.env.TURSO_DATABASE_URL) {
    console.error("Error: TURSO_DATABASE_URL is not defined");
    process.exit(1);
  }

  const email = process.argv[2];
  const scope = email
    ? await query<{ id: string }>(`SELECT id FROM users WHERE email = ?`, [email])
    : [];
  if (email && scope.length === 0) {
    console.error(`No user found with email ${email}`);
    process.exit(1);
  }
  const userFilter = email ? ` WHERE user_id = '${scope[0].id}'` : "";

  const entities = await query<EntityRow>(
    `SELECT id, user_id, canonical_name, normalized_key, entity_type, mention_count
     FROM entities${userFilter}`
  );

  const aliases = await query<AliasRow>(
    `SELECT a.entity_id, a.alias, e.canonical_name, e.entity_type
     FROM entity_aliases a JOIN entities e ON e.id = a.entity_id
     ${email ? `WHERE a.user_id = '${scope[0].id}'` : ""}`
  );

  console.log(
    `Auditing ${entities.length} entities and ${aliases.length} aliases` +
      (email ? ` for ${email}` : " across all users") +
      "\n"
  );

  // 1. Aliases whose strict key differs from their entity's.
  const manufactured = aliases.filter((a) => {
    const aliasStrict = normalizeEntityKeyStrict(a.alias);
    const entityStrict = normalizeEntityKeyStrict(a.canonical_name);
    if (!aliasStrict || !entityStrict) return false;
    if (aliasStrict === entityStrict) return false;
    // Only counts if the loose keys DO match: that is what made it a merge.
    return normalizeEntityKey(a.alias) === normalizeEntityKey(a.canonical_name);
  });

  console.log(`1. Suffix-manufactured merges already applied: ${manufactured.length}`);
  for (const row of manufactured.slice(0, 40)) {
    console.log(`     "${row.alias}"  →  "${row.canonical_name}" (${row.entity_type})`);
  }
  if (manufactured.length > 40) {
    console.log(`     ... and ${manufactured.length - 40} more`);
  }

  // 2. Distinct entities sharing a loose key (should be impossible).
  const byLooseKey = new Map<string, EntityRow[]>();
  for (const e of entities) {
    const key = `${e.user_id}::${normalizeEntityKey(e.canonical_name)}`;
    const bucket = byLooseKey.get(key);
    if (bucket) bucket.push(e);
    else byLooseKey.set(key, [e]);
  }
  const collisions = [...byLooseKey.values()].filter((g) => g.length > 1);

  console.log(`\n2. Distinct entities sharing a loose key: ${collisions.length}`);
  for (const group of collisions.slice(0, 20)) {
    console.log(
      `     ${group
        .map((e) => `"${e.canonical_name}" (${e.mention_count})`)
        .join("  vs  ")}`
    );
  }
  if (collisions.length > 20) {
    console.log(`     ... and ${collisions.length - 20} more`);
  }

  const total = manufactured.length + collisions.length;
  console.log(
    `\n${total === 0 ? "✓" : "!"} ${total} finding(s). ` +
      (total === 0
        ? "The gate will change nothing about existing data."
        : "Each is a pair the gate would now ask you to confirm.")
  );
  console.log("Nothing was written.");
}

audit().catch((e) => {
  console.error("Audit failed:", e);
  process.exit(1);
});
