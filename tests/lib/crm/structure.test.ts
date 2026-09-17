/**
 * Integration tests for the structure module against a real in-memory libsql
 * database. The db client is mocked only to point at that database, so the
 * module's actual SQL runs.
 *
 * Covers the movability requirement and, most importantly, the invariant that
 * history never moves with the product.
 */

import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";

const { testDb } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createClient } = require("@libsql/client");
  return { testDb: createClient({ url: ":memory:" }) };
});

vi.mock("@/lib/db/client", () => ({
  db: testDb,
  query: async (sql: string, args: unknown[] = []) =>
    (await testDb.execute({ sql, args })).rows.map((r: object) => ({ ...r })),
  queryAll: async (sql: string, args: unknown[] = []) =>
    (await testDb.execute({ sql, args })).rows.map((r: object) => ({ ...r })),
  queryOne: async (sql: string, args: unknown[] = []) => {
    const rows = (await testDb.execute({ sql, args })).rows;
    return rows[0] ? { ...rows[0] } : null;
  },
  mutate: async (sql: string, args: unknown[] = []) => {
    const rows = (await testDb.execute({ sql, args })).rows;
    return rows[0] ? { ...rows[0] } : null;
  },
}));

import { schema } from "@/lib/db/schema";
import { applyCrmPhase0Migration } from "@/lib/crm/schema";
import {
  createVenture,
  createProduct,
  moveToVenture,
  listVentures,
  listVentureMembers,
  listUnassignedProducts,
  getProductVenture,
  setContactRole,
  removeContactRole,
  listContactRoles,
  isContactRole,
  StructureError,
} from "@/lib/crm/structure";
import { logInteraction } from "@/lib/crm/interactions";
import { isVenture, readEntityMetadata } from "@/lib/crm/metadata";
import {
  seedVentures,
  BASELINE_COMPLIANCE_RULES,
} from "@/lib/crm/seed";

const USER = "u1";

const DATA_TABLES = [
  "interactions",
  "contact_channels",
  "entity_edges",
  "entity_aliases",
  "entity_mentions",
  "entities",
  "projects",
  "users",
];

/** Apply the real schema and the real migration once for the whole file. */
async function setupSchema() {
  const statements = schema
    .replace(/CREATE TRIGGER[\s\S]*?END;/g, "")
    .replace(/^\s*--.*$/gm, "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const s of statements) await testDb.execute(s);
  await applyCrmPhase0Migration(testDb);
}

/** Clear data between tests. Cheaper and safer than dropping the schema. */
async function reset() {
  for (const table of DATA_TABLES) {
    await testDb.execute(`DELETE FROM ${table}`);
  }
  await testDb.execute(
    `INSERT INTO users (id, email) VALUES ('${USER}','a@b.com')`
  );
}

beforeAll(setupSchema);

describe("createVenture", () => {
  beforeEach(reset);

  it("creates a name-locked org entity flagged as a venture", async () => {
    const { entity, adopted } = await createVenture(USER, {
      name: "Cedar Line",
      complianceRules: ["No health or therapeutic claims."],
    });
    expect(adopted).toBe(false);
    expect(entity.entity_type).toBe("org");
    expect(isVenture(entity)).toBe(true);
    const meta = readEntityMetadata(entity);
    expect(meta.name_locked).toBe(true);
    expect(meta.venture?.slug).toBe("cedar-line");
    expect(meta.venture?.compliance_rules).toEqual([
      "No health or therapeutic claims.",
    ]);
  });

  it("adopts an entity extraction already created, preserving its history", async () => {
    await testDb.execute(
      `INSERT INTO entities (id, user_id, canonical_name, normalized_key, entity_type, mention_count, metadata)
       VALUES ('e-ws','${USER}','Cedar Line','cedarline','org', 13, '{"aliases":["Sowa"],"other":1}')`
    );

    const { entity, adopted } = await createVenture(USER, { name: "Cedar Line" });

    expect(adopted).toBe(true);
    expect(entity.id).toBe("e-ws");
    expect(entity.mention_count).toBe(13);
    const meta = readEntityMetadata(entity);
    expect(meta.aliases).toEqual(["Sowa"]);
    expect(meta.other).toBe(1);
    expect(meta.is_venture).toBe(true);
  });

  it("rejects a name with no usable characters", async () => {
    await expect(createVenture(USER, { name: "!!!" })).rejects.toThrow(
      StructureError
    );
  });
});

describe("createProduct and membership", () => {
  beforeEach(reset);

  it("creates a product attached to a venture", async () => {
    const { entity: venture } = await createVenture(USER, {
      name: "Sable Labs",
    });
    const { entity: eden } = await createProduct(USER, {
      name: "Eden",
      ventureId: venture.id,
    });

    expect(eden.entity_type).toBe("product");
    const parent = await getProductVenture(USER, eden.id);
    expect(parent?.id).toBe(venture.id);

    const members = await listVentureMembers(USER, venture.id);
    expect(members.products.map((p) => p.canonical_name)).toEqual(["Eden"]);
  });

  it("refuses to attach a product to something that is not a venture", async () => {
    const { entity: notAVenture } = await createProduct(USER, { name: "Widget" });
    await expect(
      createProduct(USER, { name: "Eden", ventureId: notAVenture.id })
    ).rejects.toThrow(/not a venture/);
  });

  it("refuses to turn an existing venture into a product", async () => {
    const { entity: venture } = await createVenture(USER, { name: "Northwind Farms" });
    await expect(createProduct(USER, { name: "Northwind Farms" })).rejects.toThrow(
      /already exists as a venture/
    );
    expect(isVenture((await getProductVenture(USER, venture.id)) ?? venture)).toBe(
      true
    );
  });

  it("lists a product with no venture as unassigned rather than hiding it", async () => {
    const { entity } = await createProduct(USER, { name: "Activator" });
    const unassigned = await listUnassignedProducts(USER);
    expect(unassigned.map((p) => p.id)).toContain(entity.id);
  });
});

describe("moveToVenture", () => {
  beforeEach(reset);

  it("moves a product and leaves exactly one part_of edge", async () => {
    const { entity: a } = await createVenture(USER, { name: "Sable Labs" });
    const { entity: b } = await createVenture(USER, { name: "Cedar Line" });
    const { entity: eden } = await createProduct(USER, {
      name: "Eden",
      ventureId: a.id,
    });

    await moveToVenture(USER, "product", eden.id, b.id);
    await moveToVenture(USER, "product", eden.id, a.id);
    await moveToVenture(USER, "product", eden.id, b.id);

    const edges = await testDb.execute({
      sql: `SELECT * FROM entity_edges WHERE source_entity_id = ? AND edge_type = 'part_of'`,
      args: [eden.id],
    });
    expect(edges.rows.length).toBe(1);
    expect(edges.rows[0].target_entity_id).toBe(b.id);
  });

  it("unassigns with a null venture", async () => {
    const { entity: v } = await createVenture(USER, { name: "Sable Labs" });
    const { entity: eden } = await createProduct(USER, {
      name: "Eden",
      ventureId: v.id,
    });

    await moveToVenture(USER, "product", eden.id, null);

    expect(await getProductVenture(USER, eden.id)).toBeNull();
    expect((await listUnassignedProducts(USER)).map((p) => p.id)).toContain(
      eden.id
    );
  });

  it("rejects a non-venture target", async () => {
    const { entity: eden } = await createProduct(USER, { name: "Eden" });
    const { entity: other } = await createProduct(USER, { name: "Activator" });
    await expect(
      moveToVenture(USER, "product", eden.id, other.id)
    ).rejects.toThrow(/not a venture/);
  });

  it("refuses to nest a venture inside a venture", async () => {
    const { entity: a } = await createVenture(USER, { name: "Sable Labs" });
    const { entity: b } = await createVenture(USER, { name: "Cedar Line" });
    await expect(moveToVenture(USER, "product", a.id, b.id)).rejects.toThrow(
      /do not nest/
    );
  });

  it("moves a project by updating its column", async () => {
    const { entity: v } = await createVenture(USER, { name: "Northwind Farms" });
    await testDb.execute(
      `INSERT INTO projects (id, user_id, name, slug) VALUES ('p1','${USER}','Farm Show','farm-show')`
    );

    await moveToVenture(USER, "project", "p1", v.id);
    let members = await listVentureMembers(USER, v.id);
    expect(members.projects.map((p) => p.id)).toEqual(["p1"]);

    await moveToVenture(USER, "project", "p1", null);
    members = await listVentureMembers(USER, v.id);
    expect(members.projects).toEqual([]);
  });

  it("404s on an unknown member", async () => {
    const { entity: v } = await createVenture(USER, { name: "Northwind Farms" });
    await expect(
      moveToVenture(USER, "product", "nope", v.id)
    ).rejects.toThrow(/not found/);
    await expect(
      moveToVenture(USER, "project", "nope", v.id)
    ).rejects.toThrow(/not found/);
  });
});

describe("history stability", () => {
  beforeEach(reset);

  it("keeps a past interaction on its original venture after the product moves", async () => {
    // This is the invariant that makes movable products safe. If it ever fails,
    // someone replaced the stored venture_id with a join on the current edge.
    const { entity: myco } = await createVenture(USER, { name: "Sable Labs" });
    const { entity: sowa } = await createVenture(USER, { name: "Cedar Line" });
    const { entity: eden } = await createProduct(USER, {
      name: "Eden",
      ventureId: myco.id,
    });
    await testDb.execute(
      `INSERT INTO entities (id, user_id, canonical_name, normalized_key, entity_type)
       VALUES ('c1','${USER}','Dana','dana','person')`
    );

    const { interaction } = await logInteraction(USER, {
      entityId: "c1",
      ventureId: myco.id,
      channel: "call",
      occurredAt: "2026-09-01T10:00:00Z",
      subject: "Eden pod preorder",
    });
    expect(interaction.venture_id).toBe(myco.id);

    await moveToVenture(USER, "product", eden.id, sowa.id);

    const after = await testDb.execute({
      sql: `SELECT venture_id FROM interactions WHERE id = ?`,
      args: [interaction.id],
    });
    expect(after.rows[0].venture_id).toBe(myco.id);

    // And the venture's own interaction count still reflects what happened.
    const summaries = await listVentures(USER);
    const mycoSummary = summaries.find((s) => s.entity.id === myco.id);
    const sowaSummary = summaries.find((s) => s.entity.id === sowa.id);
    expect(mycoSummary?.interactionCount).toBe(1);
    expect(sowaSummary?.interactionCount).toBe(0);
    expect(sowaSummary?.productCount).toBe(1);
    expect(mycoSummary?.productCount).toBe(0);
  });
});

describe("logInteraction", () => {
  beforeEach(reset);

  it("dedupes four captures of one meeting into a single row", async () => {
    await testDb.execute(
      `INSERT INTO entities (id, user_id, canonical_name, normalized_key, entity_type)
       VALUES ('c1','${USER}','Dana Okonkwo','amynorthwind','person')`
    );

    const times = [
      "2026-09-13T09:02:11Z",
      "2026-09-13T09:04:48Z",
      "2026-09-13T09:11:03Z",
      "2026-09-13T17:45:00Z",
    ];
    const results = [];
    for (const occurredAt of times) {
      results.push(
        await logInteraction(USER, {
          entityId: "c1",
          channel: "meeting",
          occurredAt,
          subject: "Meeting with Dana Okonkwo",
        })
      );
    }

    expect(results[0].deduped).toBe(false);
    expect(results.slice(1).every((r) => r.deduped)).toBe(true);

    const rows = await testDb.execute(`SELECT * FROM interactions`);
    expect(rows.rows.length).toBe(1);
  });

  it("stores an unresolved inbound touch rather than dropping it", async () => {
    const { interaction } = await logInteraction(USER, {
      channel: "email",
      subject: "Wholesale enquiry",
      externalId: "<abc@mail.com>",
    });
    expect(interaction.entity_id).toBeNull();
    expect(interaction.dedup_key).toBe("email:<abc@mail.com>");
  });

  it("falls back to safe defaults for an unknown channel or direction", async () => {
    const { interaction } = await logInteraction(USER, {
      channel: "carrier-pigeon" as never,
      direction: "sideways" as never,
      subject: "hello",
    });
    expect(interaction.channel).toBe("note");
    expect(interaction.direction).toBe("in");
  });
});

describe("seedVentures", () => {
  beforeEach(reset);

  /**
   * A fixture seed list.
   *
   * `seedVentures` reads the operator's own `ventures.seed.json` by default and
   * ships with nothing, so these tests pass their list in explicitly. They used
   * to assert against the original author's seven real companies, which is both
   * a privacy problem in a public repository and a test that breaks for anyone
   * who seeds their own.
   */
  const SEEDS = [
    { name: "Northwind Farms", products: [{ name: "Harvest Box" }] },
    {
      name: "Sable Labs",
      compartments: ["regulated"],
      complianceRules: ["No health or therapeutic claims of any kind."],
    },
    { name: "Third Coast Studio" },
  ];

  it("creates every seeded venture and its products", async () => {
    const report = await seedVentures(USER, SEEDS);

    const ventures = report.filter((r) => r.kind === "venture");
    expect(ventures).toHaveLength(SEEDS.length);
    expect(ventures.every((v) => v.action === "created")).toBe(true);

    const summaries = await listVentures(USER);
    expect(summaries).toHaveLength(SEEDS.length);
    expect(summaries.every((s) => isVenture(s.entity))).toBe(true);

    const northwind = summaries.find(
      (s) => s.entity.canonical_name === "Northwind Farms"
    );
    expect(northwind?.productCount).toBe(1);
    const members = await listVentureMembers(USER, northwind!.entity.id);
    expect(members.products.map((p) => p.canonical_name)).toEqual(["Harvest Box"]);
    expect(members.products[0].entity_type).toBe("product");
  });

  it("seeds nothing when no seed list is configured", async () => {
    // The shipped default: a fresh clone must not create anybody's companies.
    const report = await seedVentures(USER, []);

    expect(report).toEqual([]);
    expect(await listVentures(USER)).toHaveLength(0);
  });

  it("applies baseline rules to every venture and adds per-venture ones", async () => {
    await seedVentures(USER, SEEDS);
    const summaries = await listVentures(USER);

    for (const { entity } of summaries) {
      const rules = readEntityMetadata(entity).venture?.compliance_rules ?? [];
      for (const baseline of BASELINE_COMPLIANCE_RULES) {
        expect(rules).toContain(baseline);
      }
    }

    const sable = summaries.find((s) => s.entity.canonical_name === "Sable Labs")!;
    const sableMeta = readEntityMetadata(sable.entity);
    expect(sableMeta.venture?.compliance_rules).toContain(
      "No health or therapeutic claims of any kind."
    );
    expect(sableMeta.compartments).toEqual(["regulated"]);
  });

  it("is a no-op on a second run", async () => {
    await seedVentures(USER, SEEDS);
    const before = await testDb.execute(`SELECT COUNT(*) AS n FROM entities`);
    const beforeEdges = await testDb.execute(
      `SELECT COUNT(*) AS n FROM entity_edges WHERE edge_type = 'part_of'`
    );

    const second = await seedVentures(USER, SEEDS);
    expect(second.every((r) => r.action === "adopted")).toBe(true);

    const after = await testDb.execute(`SELECT COUNT(*) AS n FROM entities`);
    const afterEdges = await testDb.execute(
      `SELECT COUNT(*) AS n FROM entity_edges WHERE edge_type = 'part_of'`
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);
    expect(afterEdges.rows[0].n).toBe(beforeEdges.rows[0].n);
  });

  it("adopts entities extraction already created, keeping their mention counts", async () => {
    await testDb.execute(
      `INSERT INTO entities (id, user_id, canonical_name, normalized_key, entity_type, mention_count, metadata)
       VALUES ('e-nw','${USER}','Northwind Farms','northwind','org', 42, '{"aliases":["NWF"]}'),
              ('e-sable','${USER}','Sable Labs','sablelabs','other', 7, '{}')`
    );

    const report = await seedVentures(USER, SEEDS);

    // normalizeEntityKey strips "Farms" as a business suffix, so the stored
    // key is "northwind" — that collapsing is the behaviour being relied on.
    const nw = report.find((r) => r.name === "Northwind Farms")!;
    expect(nw.action).toBe("adopted");
    expect(nw.entityId).toBe("e-nw");
    expect(nw.mentionCount).toBe(42);

    const stored = await testDb.execute(
      `SELECT * FROM entities WHERE id = 'e-nw'`
    );
    expect(stored.rows[0].mention_count).toBe(42);
    expect(readEntityMetadata(stored.rows[0].metadata as string).aliases).toEqual([
      "NWF",
    ]);

    // An entity typed 'other' is corrected to 'org' when adopted as a venture.
    const sable = await testDb.execute(`SELECT * FROM entities WHERE id = 'e-sable'`);
    expect(sable.rows[0].entity_type).toBe("org");

    // Adopted, not duplicated.
    expect(await listVentures(USER)).toHaveLength(SEEDS.length);
  });

  it("locks every seeded name against renaming by note extraction", async () => {
    await seedVentures(USER, SEEDS);
    for (const { entity } of await listVentures(USER)) {
      expect(readEntityMetadata(entity).name_locked).toBe(true);
    }
  });
});

describe("contact roles", () => {
  beforeEach(reset);

  async function person(id: string, name: string) {
    await testDb.execute({
      sql: `INSERT INTO entities (id, user_id, canonical_name, normalized_key, entity_type)
            VALUES (?, ?, ?, ?, 'person')`,
      args: [id, USER, name, name.toLowerCase().replace(/[^a-z0-9]/g, "")],
    });
  }

  it("attaches a contact to a venture in a role", async () => {
    const { entity: v } = await createVenture(USER, { name: "Sable Labs" });
    await person("will", "Will");

    await setContactRole(USER, "will", v.id, "partner", "co-founder");

    const roles = await listContactRoles(USER, "will");
    expect(roles).toEqual([
      {
        ventureId: v.id,
        ventureName: "Sable Labs",
        role: "partner",
        reason: "co-founder",
      },
    ]);
  });

  it("lets one contact hold roles at several ventures", async () => {
    const { entity: a } = await createVenture(USER, { name: "Sable Labs" });
    const { entity: b } = await createVenture(USER, { name: "Ridgeway Collective" });
    await person("will", "Will");

    await setContactRole(USER, "will", a.id, "partner");
    await setContactRole(USER, "will", b.id, "collaborator");

    const roles = await listContactRoles(USER, "will");
    expect(roles.map((r) => r.role).sort()).toEqual(["collaborator", "partner"]);
  });

  it("lets one contact hold several roles at one venture", async () => {
    const { entity: v } = await createVenture(USER, { name: "Northwind Farms" });
    await person("will", "Will");

    await setContactRole(USER, "will", v.id, "partner");
    await setContactRole(USER, "will", v.id, "advisor_to");

    expect(await listContactRoles(USER, "will")).toHaveLength(2);
  });

  it("is idempotent for the same role, updating the note", async () => {
    const { entity: v } = await createVenture(USER, { name: "Northwind Farms" });
    await person("will", "Will");

    await setContactRole(USER, "will", v.id, "partner", "first");
    await setContactRole(USER, "will", v.id, "partner", "second");

    const roles = await listContactRoles(USER, "will");
    expect(roles).toHaveLength(1);
    expect(roles[0].reason).toBe("second");
  });

  it("removes one role and leaves the others", async () => {
    const { entity: v } = await createVenture(USER, { name: "Northwind Farms" });
    await person("will", "Will");
    await setContactRole(USER, "will", v.id, "partner");
    await setContactRole(USER, "will", v.id, "advisor_to");

    expect(await removeContactRole(USER, "will", v.id, "partner")).toBe(true);
    const roles = await listContactRoles(USER, "will");
    expect(roles.map((r) => r.role)).toEqual(["advisor_to"]);

    // Removing an absent role reports false rather than throwing.
    expect(await removeContactRole(USER, "will", v.id, "partner")).toBe(false);
  });

  it("rejects a non-venture target and a venture as the contact", async () => {
    const { entity: v } = await createVenture(USER, { name: "Northwind Farms" });
    const { entity: b } = await createVenture(USER, { name: "Cedar Line" });
    await person("will", "Will");
    const { entity: product } = await createProduct(USER, { name: "Activator" });

    await expect(
      setContactRole(USER, "will", product.id, "partner")
    ).rejects.toThrow(/not a venture/);
    await expect(setContactRole(USER, b.id, v.id, "partner")).rejects.toThrow(
      /do not hold roles/
    );
    await expect(setContactRole(USER, "nope", v.id, "partner")).rejects.toThrow(
      /not found/
    );
  });

  it("counts only role edges as contacts, not co-occurrence", async () => {
    const { entity: v } = await createVenture(USER, { name: "Northwind Farms" });
    await person("will", "Will");
    await person("dana", "Dana");

    // A `related` edge is written automatically whenever two entities appear in
    // one note. It must not inflate the venture's contact count.
    await testDb.execute({
      sql: `INSERT INTO entity_edges (user_id, source_entity_id, target_entity_id, edge_type)
            VALUES (?, 'dana', ?, 'related')`,
      args: [USER, v.id],
    });
    await setContactRole(USER, "will", v.id, "partner");

    const summary = (await listVentures(USER)).find((s) => s.entity.id === v.id);
    expect(summary?.contactCount).toBe(1);
  });

  it("validates role names", () => {
    expect(isContactRole("partner")).toBe(true);
    expect(isContactRole("related")).toBe(false);
    expect(isContactRole("nemesis")).toBe(false);
  });
});
