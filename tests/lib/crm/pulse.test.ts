/**
 * Integration tests for the dashboard's CRM summary, against a real in-memory
 * libsql database so the module's actual SQL runs.
 *
 * The cases that matter are the ones that decide whether the dashboard shows a
 * card at all: absent metadata must read as "fine" (otherwise every entity
 * written before the CRM existed flags for review on day one), ventures must
 * not be counted as contacts, and a database without the Phase 0 tables must
 * degrade rather than throw — the dashboard is the app's front door.
 */

import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";

const { testDb } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createClient } = require("@libsql/client");
  return { testDb: createClient({ url: ":memory:" }) };
});

vi.mock("@/lib/db/client", () => ({ db: testDb }));

import { schema } from "@/lib/db/schema";
import { applyCrmPhase0Migration } from "@/lib/crm/schema";
import { getCrmPulse } from "@/lib/crm/pulse";

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

async function reset() {
  for (const table of DATA_TABLES) {
    await testDb.execute(`DELETE FROM ${table}`);
  }
  await testDb.execute(
    `INSERT INTO users (id, email) VALUES ('${USER}','a@b.com')`
  );
}

async function addEntity(
  id: string,
  name: string,
  metadata: Record<string, unknown> = {},
  entityType = "person"
) {
  await testDb.execute({
    sql: `INSERT INTO entities (id, user_id, canonical_name, normalized_key, entity_type, metadata)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [id, USER, name, name.toLowerCase(), entityType, JSON.stringify(metadata)],
  });
}

beforeAll(setupSchema);

describe("getCrmPulse", () => {
  beforeEach(reset);

  it("reports no contacts on an empty graph, so the dashboard renders nothing", async () => {
    const pulse = await getCrmPulse(USER);
    expect(pulse).toMatchObject({
      hasContacts: false,
      contactCount: 0,
      needsReview: 0,
      followUpsDue: 0,
      recentTouches: [],
    });
  });

  it("treats absent metadata as the ordinary case, never as needing attention", async () => {
    await addEntity("e1", "Northwind", {});
    await addEntity("e2", "Maya", {});

    const pulse = await getCrmPulse(USER);
    expect(pulse.contactCount).toBe(2);
    expect(pulse.hasContacts).toBe(true);
    expect(pulse.needsReview).toBe(0);
    expect(pulse.followUpsDue).toBe(0);
  });

  it("counts unresolved captures and flagged duplicates as needing review", async () => {
    await addEntity("e1", "Rascal", { resolution: "unresolved" });
    await addEntity("e2", "Northwind Farms", {
      merge_candidate: { target_entity_id: "e3", confidence: 0.8, reason: "suffix" },
    });
    await addEntity("e3", "Northwind Holdings", {});

    const pulse = await getCrmPulse(USER);
    expect(pulse.contactCount).toBe(3);
    expect(pulse.needsReview).toBe(2);
  });

  it("counts a follow-up only once its date has arrived", async () => {
    await addEntity("e1", "Due", { crm: { next_action_at: "2000-01-01 00:00:00" } });
    await addEntity("e2", "Later", { crm: { next_action_at: "2999-01-01 00:00:00" } });
    await addEntity("e3", "None", { crm: { owner: "me" } });

    const pulse = await getCrmPulse(USER);
    expect(pulse.followUpsDue).toBe(1);
  });

  it("excludes ventures, which are orgs but not contacts", async () => {
    await addEntity("v1", "Cedar Line", { is_venture: true }, "org");
    await addEntity("e1", "Maya", {});

    const pulse = await getCrmPulse(USER);
    expect(pulse.contactCount).toBe(1);
  });

  it("survives a malformed metadata row rather than taking the dashboard down", async () => {
    await testDb.execute({
      sql: `INSERT INTO entities (id, user_id, canonical_name, normalized_key, entity_type, metadata)
            VALUES ('bad', ?, 'Broken', 'broken', 'person', 'not json')`,
      args: [USER],
    });
    await addEntity("e1", "Maya", { resolution: "unresolved" });

    const pulse = await getCrmPulse(USER);
    expect(pulse.contactCount).toBe(2);
    expect(pulse.needsReview).toBe(1);
  });

  it("returns the three most recent touches, newest first, with contact names", async () => {
    await addEntity("e1", "Maya", {});
    for (const [i, when] of ["2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01"].entries()) {
      await testDb.execute({
        sql: `INSERT INTO interactions (id, user_id, entity_id, channel, direction, subject, occurred_at, dedup_key)
              VALUES (?, ?, 'e1', 'email', 'in', ?, ?, ?)`,
        args: [`i${i}`, USER, `Subject ${i}`, when, `k${i}`],
      });
    }

    const pulse = await getCrmPulse(USER);
    expect(pulse.recentTouches).toHaveLength(3);
    expect(pulse.recentTouches[0].occurredAt).toBe("2026-04-01");
    expect(pulse.recentTouches[0].contactName).toBe("Maya");
  });

  it("scopes every count to the calling user", async () => {
    await testDb.execute(`INSERT INTO users (id, email) VALUES ('u2','b@c.com')`);
    await testDb.execute({
      sql: `INSERT INTO entities (id, user_id, canonical_name, normalized_key, entity_type, metadata)
            VALUES ('other', 'u2', 'Theirs', 'theirs', 'person', '{"resolution":"unresolved"}')`,
      args: [],
    });

    const pulse = await getCrmPulse(USER);
    expect(pulse.contactCount).toBe(0);
    expect(pulse.needsReview).toBe(0);
  });
});

describe("getCrmPulse without the Phase 0 migration", () => {
  it("returns zero touches rather than throwing when `interactions` is absent", async () => {
    await reset();
    await testDb.execute("DROP TABLE interactions");
    try {
      const pulse = await getCrmPulse(USER);
      expect(pulse.recentTouches).toEqual([]);
      expect(pulse.contactCount).toBe(0);
    } finally {
      await applyCrmPhase0Migration(testDb);
    }
  });
});
