/**
 * Venture, product and project structure.
 *
 * A venture is an `org` entity carrying `metadata.is_venture`. A product is a
 * `product` entity attached to one venture by a `part_of` edge. A project stays
 * in the existing `projects` table with a `venture_id` column, because a
 * project already owns notes, tasks and collaborators and mirroring it into the
 * entity graph would create two homes for one object.
 *
 * Two storages, one interface, so callers never branch on where a member lives.
 *
 * THE INVARIANT THAT MATTERS: history never moves with the product. Moving Eden
 * from Sable Labs to another venture must not change the venture recorded
 * on interactions that already happened. That is why `interactions.venture_id`
 * is written at insert time and never derived here — nothing in this module
 * rewrites an existing interaction, and nothing in the read path resolves a
 * venture by walking the current edge.
 */

import { db, query, queryOne, mutate } from "@/lib/db/client";
import {
  ENTITY_ROLE_EDGE_TYPES,
  type Entity,
  type EntityEdgeType,
  type Project,
} from "@/lib/db/schema";
import { normalizeEntityKey, cleanEntityName } from "@/lib/entities/resolve";
import { readEntityMetadata, writeEntityMetadata, isVenture } from "./metadata";

export type MemberKind = "product" | "project";

export interface VentureSummary {
  entity: Entity;
  productCount: number;
  projectCount: number;
  contactCount: number;
  interactionCount: number;
}

export interface VentureMembers {
  products: Entity[];
  projects: Project[];
}

export class StructureError extends Error {
  constructor(
    message: string,
    readonly status: number = 400
  ) {
    super(message);
    this.name = "StructureError";
  }
}

/** Fetch an entity scoped to its owner. */
async function getEntity(userId: string, id: string): Promise<Entity | null> {
  return queryOne<Entity>(
    `SELECT * FROM entities WHERE id = ? AND user_id = ?`,
    [id, userId]
  );
}

/** Resolve and validate a venture id, or throw a caller-friendly error. */
async function requireVenture(userId: string, ventureId: string): Promise<Entity> {
  const entity = await getEntity(userId, ventureId);
  if (!entity) throw new StructureError("Venture not found", 404);
  if (!isVenture(entity)) {
    throw new StructureError(
      `"${entity.canonical_name}" is not a venture`,
      400
    );
  }
  return entity;
}

export async function listVentures(userId: string): Promise<VentureSummary[]> {
  // is_venture lives in a JSON column, so filter in SQL on the substring and
  // confirm with the strict reader rather than trusting the LIKE.
  const candidates = await query<Entity>(
    `SELECT * FROM entities
     WHERE user_id = ? AND entity_type = 'org' AND metadata LIKE '%"is_venture"%'
     ORDER BY canonical_name COLLATE NOCASE`,
    [userId]
  );
  const ventures = candidates.filter(isVenture);
  if (ventures.length === 0) return [];

  const ids = ventures.map((v) => v.id);
  const placeholders = ids.map(() => "?").join(",");

  const productCounts = await query<{ target_entity_id: string; n: number }>(
    `SELECT target_entity_id, COUNT(*) AS n FROM entity_edges
     WHERE user_id = ? AND edge_type = 'part_of' AND target_entity_id IN (${placeholders})
     GROUP BY target_entity_id`,
    [userId, ...ids]
  );
  const projectCounts = await query<{ venture_id: string; n: number }>(
    `SELECT venture_id, COUNT(*) AS n FROM projects
     WHERE user_id = ? AND venture_id IN (${placeholders})
     GROUP BY venture_id`,
    [userId, ...ids]
  );
  // Only deliberate role edges count as contacts. `related` edges are written
  // automatically by co-occurrence, so counting them would report every entity
  // ever mentioned in the same note as a contact of the venture.
  const rolePlaceholders = ENTITY_ROLE_EDGE_TYPES.map(() => "?").join(",");
  const contactCounts = await query<{ target_entity_id: string; n: number }>(
    `SELECT target_entity_id, COUNT(DISTINCT source_entity_id) AS n FROM entity_edges
     WHERE user_id = ? AND edge_type IN (${rolePlaceholders})
       AND target_entity_id IN (${placeholders})
     GROUP BY target_entity_id`,
    [userId, ...ENTITY_ROLE_EDGE_TYPES, ...ids]
  );
  const interactionCounts = await query<{ venture_id: string; n: number }>(
    `SELECT venture_id, COUNT(*) AS n FROM interactions
     WHERE user_id = ? AND venture_id IN (${placeholders})
     GROUP BY venture_id`,
    [userId, ...ids]
  );

  const lookup = (
    rows: { n: number }[],
    key: "target_entity_id" | "venture_id",
    id: string
  ) =>
    Number(
      (rows as Record<string, unknown>[]).find((r) => r[key] === id)?.n ?? 0
    );

  return ventures.map((entity) => ({
    entity,
    productCount: lookup(productCounts, "target_entity_id", entity.id),
    projectCount: lookup(projectCounts, "venture_id", entity.id),
    contactCount: lookup(contactCounts, "target_entity_id", entity.id),
    interactionCount: lookup(interactionCounts, "venture_id", entity.id),
  }));
}

export async function listVentureMembers(
  userId: string,
  ventureId: string
): Promise<VentureMembers> {
  await requireVenture(userId, ventureId);

  const products = await query<Entity>(
    `SELECT e.* FROM entities e
     JOIN entity_edges ed ON ed.source_entity_id = e.id
     WHERE ed.user_id = ? AND ed.edge_type = 'part_of' AND ed.target_entity_id = ?
     ORDER BY e.canonical_name COLLATE NOCASE`,
    [userId, ventureId]
  );
  const projects = await query<Project>(
    `SELECT * FROM projects WHERE user_id = ? AND venture_id = ?
     ORDER BY name COLLATE NOCASE`,
    [userId, ventureId]
  );

  return { products, projects };
}

/** Products with no `part_of` edge. A valid state, shown rather than hidden. */
export async function listUnassignedProducts(userId: string): Promise<Entity[]> {
  return query<Entity>(
    `SELECT e.* FROM entities e
     WHERE e.user_id = ? AND e.entity_type = 'product'
       AND NOT EXISTS (
         SELECT 1 FROM entity_edges ed
         WHERE ed.source_entity_id = e.id AND ed.edge_type = 'part_of'
       )
     ORDER BY e.canonical_name COLLATE NOCASE`,
    [userId]
  );
}

export interface VentureInput {
  name: string;
  slug?: string;
  sendingIdentity?: { email?: string; display_name?: string; signature?: string };
  voice?: string;
  complianceRules?: string[];
  compartments?: string[];
}

/**
 * Create a venture, or adopt an existing entity that already holds its key.
 *
 * Adoption rather than a 409 is deliberate and mirrors the seed script: a
 * venture's name has almost certainly already been extracted from notes into an
 * `org` entity with real mention history. Refusing to create would strand that
 * history; overwriting would discard it. Adopting keeps `mention_count`,
 * `first_seen_at` and every metadata key written by other subsystems.
 */
export async function createVenture(
  userId: string,
  input: VentureInput
): Promise<{ entity: Entity; adopted: boolean }> {
  const name = cleanEntityName(input.name);
  if (!name) throw new StructureError("A venture needs a name");

  const key = normalizeEntityKey(name);
  if (!key) throw new StructureError("That name has no usable characters");

  const patch = {
    is_venture: true,
    name_locked: true,
    venture: {
      slug: input.slug ?? slugify(name),
      ...(input.sendingIdentity ? { sending_identity: input.sendingIdentity } : {}),
      ...(input.voice ? { voice: input.voice } : {}),
      ...(input.complianceRules?.length
        ? { compliance_rules: input.complianceRules }
        : {}),
    },
    ...(input.compartments?.length ? { compartments: input.compartments } : {}),
  };

  const existing = await queryOne<Entity>(
    `SELECT * FROM entities WHERE user_id = ? AND normalized_key = ?`,
    [userId, key]
  );

  if (existing) {
    // Preserve the existing venture config rather than replacing it wholesale.
    const currentVenture = readEntityMetadata(existing).venture ?? {};
    const metadata = writeEntityMetadata(existing, {
      ...patch,
      venture: { ...currentVenture, ...patch.venture },
    });
    await db.execute({
      sql: `UPDATE entities SET entity_type = 'org', metadata = ?, updated_at = datetime('now') WHERE id = ?`,
      args: [metadata, existing.id],
    });
    const entity = await getEntity(userId, existing.id);
    return { entity: entity!, adopted: true };
  }

  const created = await mutate<Entity>(
    `INSERT INTO entities (user_id, canonical_name, normalized_key, entity_type, mention_count, metadata)
     VALUES (?, ?, ?, 'org', 0, ?)
     RETURNING *`,
    [userId, name, key, writeEntityMetadata("{}", patch)]
  );
  if (!created) throw new StructureError("Could not create the venture", 500);
  return { entity: created, adopted: false };
}

export interface ProductInput {
  name: string;
  ventureId?: string | null;
  sku?: string;
  compartments?: string[];
}

export async function createProduct(
  userId: string,
  input: ProductInput
): Promise<{ entity: Entity; adopted: boolean }> {
  const name = cleanEntityName(input.name);
  if (!name) throw new StructureError("A product needs a name");

  const key = normalizeEntityKey(name);
  if (!key) throw new StructureError("That name has no usable characters");

  if (input.ventureId) await requireVenture(userId, input.ventureId);

  const patch = {
    name_locked: true,
    ...(input.sku ? { sku: input.sku } : {}),
    ...(input.compartments?.length ? { compartments: input.compartments } : {}),
  };

  const existing = await queryOne<Entity>(
    `SELECT * FROM entities WHERE user_id = ? AND normalized_key = ?`,
    [userId, key]
  );

  let entity: Entity;
  let adopted = false;

  if (existing) {
    if (isVenture(existing)) {
      throw new StructureError(
        `"${existing.canonical_name}" already exists as a venture`,
        409
      );
    }
    await db.execute({
      sql: `UPDATE entities SET entity_type = 'product', metadata = ?, updated_at = datetime('now') WHERE id = ?`,
      args: [writeEntityMetadata(existing, patch), existing.id],
    });
    entity = (await getEntity(userId, existing.id))!;
    adopted = true;
  } else {
    const created = await mutate<Entity>(
      `INSERT INTO entities (user_id, canonical_name, normalized_key, entity_type, mention_count, metadata)
       VALUES (?, ?, ?, 'product', 0, ?)
       RETURNING *`,
      [userId, name, key, writeEntityMetadata("{}", patch)]
    );
    if (!created) throw new StructureError("Could not create the product", 500);
    entity = created;
  }

  if (input.ventureId) {
    await moveToVenture(userId, "product", entity.id, input.ventureId);
  }

  return { entity, adopted };
}

/**
 * Attach a product or project to a venture, or detach it with `ventureId: null`.
 *
 * For a product this deletes any existing `part_of` edge before inserting the
 * new one, which is what enforces "one venture at a time". The database's
 * UNIQUE(source, target, edge_type) keys on the pair, so it cannot enforce that
 * rule on its own.
 *
 * Existing interactions are untouched. See the invariant at the top of the file.
 */
export async function moveToVenture(
  userId: string,
  kind: MemberKind,
  id: string,
  ventureId: string | null
): Promise<void> {
  if (ventureId) await requireVenture(userId, ventureId);

  if (kind === "project") {
    const project = await queryOne<Project>(
      `SELECT id FROM projects WHERE id = ? AND user_id = ?`,
      [id, userId]
    );
    if (!project) throw new StructureError("Project not found", 404);

    await db.execute({
      sql: `UPDATE projects SET venture_id = ?, updated_at = datetime('now')
            WHERE id = ? AND user_id = ?`,
      args: [ventureId, id, userId],
    });
    return;
  }

  const product = await getEntity(userId, id);
  if (!product) throw new StructureError("Product not found", 404);
  if (isVenture(product)) {
    throw new StructureError("Ventures do not nest inside ventures", 400);
  }
  if (ventureId === id) {
    throw new StructureError("Something cannot belong to itself", 400);
  }

  await db.execute({
    sql: `DELETE FROM entity_edges
          WHERE user_id = ? AND source_entity_id = ? AND edge_type = 'part_of'`,
    args: [userId, id],
  });

  if (!ventureId) return;

  await db.execute({
    sql: `INSERT INTO entity_edges
            (user_id, source_entity_id, target_entity_id, edge_type, strength, discovery_method, reason)
          VALUES (?, ?, ?, 'part_of', 1.0, 'manual', 'Assigned to venture')`,
    args: [userId, id, ventureId],
  });
}

/** The venture a product currently belongs to, or null. */
export async function getProductVenture(
  userId: string,
  productId: string
): Promise<Entity | null> {
  return queryOne<Entity>(
    `SELECT e.* FROM entities e
     JOIN entity_edges ed ON ed.target_entity_id = e.id
     WHERE ed.user_id = ? AND ed.source_entity_id = ? AND ed.edge_type = 'part_of'
     LIMIT 1`,
    [userId, productId]
  );
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// =====================================================
// CONTACT ROLES
// =====================================================

export type ContactRole = (typeof ENTITY_ROLE_EDGE_TYPES)[number];

export function isContactRole(value: string): value is ContactRole {
  return (ENTITY_ROLE_EDGE_TYPES as readonly string[]).includes(value);
}

/**
 * Attach a contact to a venture in a named role.
 *
 * The edge reads source -> edge_type -> target: the PERSON is the source, the
 * venture the target. `Will --partner--> Sable Labs`.
 *
 * Unlike `part_of`, a contact may hold several roles at one venture and roles at
 * several ventures — that is the whole point of one Rolodex across seven
 * businesses. So this adds a role rather than replacing the existing one; use
 * `removeContactRole` to take one away.
 */
export async function setContactRole(
  userId: string,
  contactId: string,
  ventureId: string,
  role: ContactRole,
  reason?: string
): Promise<void> {
  if (!isContactRole(role)) {
    throw new StructureError(`"${role}" is not a contact role`, 400);
  }
  await requireVenture(userId, ventureId);

  const contact = await getEntity(userId, contactId);
  if (!contact) throw new StructureError("Contact not found", 404);
  if (contactId === ventureId) {
    throw new StructureError("A venture cannot hold a role at itself", 400);
  }
  if (isVenture(contact)) {
    throw new StructureError(
      "Ventures do not hold roles at other ventures",
      400
    );
  }

  await db.execute({
    sql: `INSERT INTO entity_edges
            (user_id, source_entity_id, target_entity_id, edge_type, strength, discovery_method, reason)
          VALUES (?, ?, ?, ?, 1.0, 'manual', ?)
          ON CONFLICT(source_entity_id, target_entity_id, edge_type)
          DO UPDATE SET reason = COALESCE(excluded.reason, reason),
                        strength = 1.0,
                        discovery_method = 'manual',
                        updated_at = datetime('now')`,
    args: [userId, contactId, ventureId, role, reason ?? null],
  });
}

export async function removeContactRole(
  userId: string,
  contactId: string,
  ventureId: string,
  role: ContactRole
): Promise<boolean> {
  const result = await db.execute({
    sql: `DELETE FROM entity_edges
          WHERE user_id = ? AND source_entity_id = ? AND target_entity_id = ?
            AND edge_type = ?`,
    args: [userId, contactId, ventureId, role],
  });
  return result.rowsAffected > 0;
}

/** Every role a contact holds, across all ventures. */
export async function listContactRoles(
  userId: string,
  contactId: string
): Promise<
  { ventureId: string; ventureName: string; role: EntityEdgeType; reason: string | null }[]
> {
  const placeholders = ENTITY_ROLE_EDGE_TYPES.map(() => "?").join(",");
  const rows = await query<{
    venture_id: string;
    venture_name: string;
    edge_type: EntityEdgeType;
    reason: string | null;
  }>(
    `SELECT ed.target_entity_id AS venture_id, v.canonical_name AS venture_name,
            ed.edge_type, ed.reason
     FROM entity_edges ed
     JOIN entities v ON v.id = ed.target_entity_id
     WHERE ed.user_id = ? AND ed.source_entity_id = ?
       AND ed.edge_type IN (${placeholders})
     ORDER BY v.canonical_name COLLATE NOCASE`,
    [userId, contactId, ...ENTITY_ROLE_EDGE_TYPES]
  );
  return rows.map((r) => ({
    ventureId: r.venture_id,
    ventureName: r.venture_name,
    role: r.edge_type,
    reason: r.reason,
  }));
}
