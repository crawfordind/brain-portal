/**
 * Bootstrap ventures for a fresh install.
 *
 * Seeding is OPTIONAL and ships empty. This used to hold the original author's
 * seven real businesses, which meant every clone of this repository created
 * those companies — and their compliance rules — in a stranger's database.
 *
 * To seed your own, copy `ventures.seed.example.json` to `ventures.seed.json`
 * in the project root and edit it. That file is gitignored, so your business
 * structure is yours and never lands in a pull request.
 *
 * This is a BOOTSTRAP, not a registry. Additional ventures, products and
 * projects are created through /crm and the API — that is the whole point of
 * building create-and-move in Phase 0.
 *
 * Seeding ADOPTS rather than inserts. Several names have probably already been
 * extracted from notes into `org` entities carrying real mention counts and
 * history. Refusing to create would strand that history and overwriting would
 * discard it, so an existing entity is upgraded in place with its
 * canonical_name, mention_count, first_seen_at and foreign metadata keys
 * preserved. Re-running changes nothing.
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import {
  createVenture,
  createProduct,
  type VentureInput,
} from "./structure";

/**
 * Rules every venture inherits, applied on top of its own.
 *
 * Deliberately generic. Anything specific to a particular industry, product or
 * process belongs in that venture's own `complianceRules`, in your own
 * `ventures.seed.json` — not in a file everyone gets.
 */
export const BASELINE_COMPLIANCE_RULES: string[] = [
  "Keep outbound short and direct. Do not drag on.",
];

export interface VentureSeed extends VentureInput {
  products?: { name: string; sku?: string }[];
}

/** Where an operator's own seed list lives, if they wrote one. */
export const SEED_FILE = "ventures.seed.json";

/**
 * Read the operator's seed list.
 *
 * Returns an empty list when the file is absent, which is the shipped default:
 * a fresh install seeds nothing and the user creates ventures in the app.
 * A file that exists but cannot be parsed throws, because silently seeding
 * nothing when someone wrote a config is worse than telling them it is broken.
 */
export function loadVentureSeeds(cwd: string = process.cwd()): VentureSeed[] {
  let raw: string;
  try {
    raw = readFileSync(resolve(cwd, SEED_FILE), "utf8");
  } catch {
    return [];
  }

  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`${SEED_FILE} must contain a JSON array of ventures.`);
  }

  for (const entry of parsed) {
    if (!entry || typeof entry.name !== "string" || !entry.name.trim()) {
      throw new Error(`Every entry in ${SEED_FILE} needs a non-empty "name".`);
    }
  }

  return parsed as VentureSeed[];
}

export interface SeedResultRow {
  name: string;
  kind: "venture" | "product";
  action: "created" | "adopted";
  entityId: string;
  mentionCount: number;
}

export async function seedVentures(
  userId: string,
  seeds: VentureSeed[] = loadVentureSeeds()
): Promise<SeedResultRow[]> {
  const report: SeedResultRow[] = [];

  for (const { products, ...input } of seeds) {
    const { entity, adopted } = await createVenture(userId, {
      ...input,
      complianceRules: [
        ...BASELINE_COMPLIANCE_RULES,
        ...(input.complianceRules ?? []),
      ],
    });
    report.push({
      name: entity.canonical_name,
      kind: "venture",
      action: adopted ? "adopted" : "created",
      entityId: entity.id,
      mentionCount: entity.mention_count,
    });

    for (const product of products ?? []) {
      const result = await createProduct(userId, {
        name: product.name,
        sku: product.sku,
        ventureId: entity.id,
      });
      report.push({
        name: `${result.entity.canonical_name} → ${entity.canonical_name}`,
        kind: "product",
        action: result.adopted ? "adopted" : "created",
        entityId: result.entity.id,
        mentionCount: result.entity.mention_count,
      });
    }
  }

  return report;
}
