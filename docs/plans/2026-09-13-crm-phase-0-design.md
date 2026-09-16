# CRM Phase 0: Rolodex on the entity graph

**Status:** Implemented. See the section 12 note for what changed during the build.
**Date:** 2026-09-13
**Scope:** `contact_channels` + `interactions` tables, seven seeded venture entities plus
create-and-move for ventures, products and projects, `resolution` / `compartments` /
venture metadata conventions, and a `/crm` surface.
**Explicit non-goal:** deals, pipelines, intake, drafting, compliance enforcement. Those are Phases 1 to 3.

---

## 1. Summary

Brain Portal already stores a canonical entity graph (`entities`, `entity_aliases`,
`entity_mentions`, `entity_edges`). Phase 0 turns that graph into a usable Rolodex
segmented by venture, without adding an AI feature and without a parallel contact model.

Two new tables carry what the graph cannot express:

- **`contact_channels`** answers "how do I reach this person" and, more importantly,
  "which entity does this inbound email address belong to". It is the resolver every
  later intake path depends on.
- **`interactions`** answers "what actually passed between us". This is distinct from
  `entity_mentions`, which records that an entity was *referenced in something I wrote*.
  A mention is a citation. An interaction is a touch.

Everything else in Phase 0 is metadata conventions, a structure layer for ventures,
products and projects (section 6), and one migration: three CHECK rebuilds that currently
block the design, plus a column add on `projects`.

---

## 2. Verification against the current schema

This section is the reason the plan changed. Each claim below was checked against the
code, not assumed.

### 2.1 Holds as designed

| Assumption | Verified |
|---|---|
| Ventures can be `org` entities | `entities.entity_type` CHECK includes `'org'`. Yes. |
| Venture config can live in `entities.metadata` with no migration | `metadata TEXT DEFAULT '{}'`. Yes. |
| Re-extraction will not clobber venture metadata | `upsertEntity` (`src/lib/entities/store.ts`) updates only `canonical_name` and `entity_type` on an existing row. `metadata` is written on INSERT only. Confirmed safe. |
| `entity_mentions` can record `source_type = 'interaction'` | `source_type TEXT NOT NULL`, no CHECK. Yes, zero migration. |
| CRM skills fit the skills registry | `skills.category` CHECK includes `'integration'` and `'general'`. Yes. |
| Cadence alerts can use the notification pipeline | `notifications.type` CHECK includes `'system'`. Yes for Phases 0 and 1. A dedicated `crm_followup_due` type needs a rebuild; defer to Phase 3. |

### 2.2 Does not hold, needs migration

**a. Roles-as-edges is currently impossible.**
`entity_edges.edge_type` CHECK is a closed list:
`related, supplies, funds, depends_on, blocks, located_in, works_with, same_as, part_of`.
There is no `partner`, `collaborator`, `customer`, or `member`. The table also has **no
`metadata` column**, so a role cannot carry a start date, a note, or a venture-specific
qualifier. `UNIQUE(source_entity_id, target_entity_id, edge_type)` is correct for the
design (one row per role per pair) and should be kept.

**b. Interactions cannot be embedded.**
`embeddings.entity_type` CHECK is `('note','capture','task_candidate')`. An interaction
body has nowhere to store a vector. This is the same wall documented in CLAUDE.md for
attachments. Consequence: `get_contact_brief` in Phase 2 cannot do semantic recall over
interaction text until this is widened.

**c. New queue operations are rejected.**
`processing_queue.operation` is a closed CHECK. `create-org-from-capture` and
`extract-interactions` (both Phase 1) will fail insert until added.

SQLite cannot `ALTER` a CHECK constraint. Each of the three requires a table rebuild
(create new, copy, drop, rename, recreate indexes). **Do all three in one migration
script** so the cost is paid once. `entity_edges` and `processing_queue` are small and
nothing references them by FK, so the rebuild is low risk. `embeddings` is larger; see
the phasing decision in 4.1.

### 2.3 Behavioral risks found in code

**d. `pickCanonicalName` can silently rename a venture.**
`upsertEntity` calls `pickCanonicalName(current, incoming)` on every re-extraction. An
offhand note mentioning a longer surface form can rename the canonical entity. For a
knowledge graph that is a feature. For a venture whose name is on an invoice it is a
defect. Fix: honor `metadata.name_locked`.

**e. The over-merge is a hard, silent, irreversible collision.**
`SUFFIX_TOKENS` strips `farms, farm, co, corp, company, group, holdings, partners,
associates, sons, inc, llc, ltd, ...` and then removes all non-alphanumerics. So:

```
"Northwind Farms"    -> northwind
"Northwind Holdings" -> northwind
"Northwind & Sons"   -> northwind
```

Combined with `UNIQUE(user_id, normalized_key)`, the second and third silently attach to
the first via `findEntityIdByKey`. No merge record, no undo, no signal. This is already
happening today. It is acceptable for notes and unacceptable for a contact record.

**f. The duplicate-captures problem is an interaction problem, not an entity problem.**
Four identical "meeting with Dana Okonkwo" rows on one day are four distinct sources,
so `entity_mentions`' `UNIQUE(entity_id, source_type, source_id)` correctly lets all four
through. Entity-level fuzzy matching will not fix this. `interactions` needs its own
natural key. See 5.2.

---

## 3. Scope

### In (P0-must)

1. Migration `migrate-add-crm-phase-0.ts`: two new tables, `entity_edges` rebuild,
   `processing_queue` rebuild, `projects.venture_id` column.
2. `contact_channels` table plus a pure `normalizeChannelValue`.
3. `interactions` table plus a pure `buildInteractionDedupKey`.
4. Entity metadata conventions (`src/lib/crm/metadata.ts`), typed and tested.
5. `name_locked` honored in `upsertEntity`.
6. Merge-confidence gate in entity resolution, with `merge_candidate` review state,
   plus a dry-run blast-radius script (5.4).
7. **Structure module** (`src/lib/crm/structure.ts`): one interface over venture
   membership for products (graph edges) and projects (table column). See section 6.
8. `scripts/seed-ventures.ts`, idempotent, adopts existing entities.
9. **Create and move**: API for creating ventures and products, and for reparenting a
   product or project to a different venture. Without this the seed is a dead end.
10. `/crm` list, `/crm/[entityId]` brief, `/crm/ventures`, and a minimal structure editor
    (create venture, create product, move product or project between ventures).
11. `GET /api/crm/contacts`, `GET /api/crm/contacts/[id]`,
    `POST /api/crm/interactions`, channel CRUD.

### In (P0-nice, cut if the weekend runs out)

12. `redactContactChannels` helper next to `redactSecrets`, unused until Phase 1.
13. `crm:read` / `crm:write` added to `MCP_SCOPES` and `SCOPE_PRESETS.read_only`.

### Out

Deals, pipelines, `field_schema`, kanban, BCC dropbox, ICS pull,
`create-org-from-capture` processor, `draft_outreach`, compliance enforcement,
`whats_due`, MCP tools, Timetrack revenue handoff, embeddings rebuild.

### Note on size

Items 7, 9, and the structure editor in 10 were added after the decision that products
must be movable between ventures and that new ventures, products, and projects get
created on an ongoing basis. That is the right call, but it means **Phase 0 is no longer
a weekend**. Estimate is roughly 1.5x the original. The alternative is shipping the
Rolodex first and the structure editor as Phase 0.5, which is a reasonable split if the
Farm Show timeline gets tight.

## 4. Migration

Single script: `scripts/migrate-add-crm-phase-0.ts`, following the existing
`migrate-add-entity-layer.ts` shape (labeled statements, idempotent, skips
"already exists"). Use `db.batch(..., "write")` for each rebuild so it is atomic.

### 4.1 Rebuilds

**`entity_edges`** - widen `edge_type` and add `metadata`:

```sql
CREATE TABLE entity_edges_new (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  target_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  edge_type TEXT NOT NULL DEFAULT 'related' CHECK (edge_type IN (
    'related','supplies','funds','depends_on','blocks','located_in',
    'works_with','same_as','part_of',
    -- CRM roles, added Phase 0
    'partner','collaborator','customer_of','member_of',
    'advisor_to','investor_in','employed_by','reports_to','contact_at'
  )),
  strength REAL DEFAULT 0.5,
  reason TEXT,
  discovery_method TEXT DEFAULT 'co_occurrence'
    CHECK (discovery_method IN ('co_occurrence','llm','manual')),
  co_occurrence_count INTEGER DEFAULT 0,
  metadata TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(source_entity_id, target_entity_id, edge_type)
);
-- INSERT INTO entity_edges_new (...) SELECT ..., '{}', ... FROM entity_edges;
-- DROP TABLE entity_edges; ALTER TABLE entity_edges_new RENAME TO entity_edges;
-- recreate idx_entity_edges_source, idx_entity_edges_target
```

**Edge direction is a convention and must be documented in code**, because it is the
classic place this kind of graph rots. The rule:

> The edge reads **source, edge_type, target**. The person is always the source, the
> venture or org is always the target.
> `Will --partner--> Sable Labs`. `Will --collaborator--> Ridgeway Collective`.

`supplies` is the one that already exists and reads the other way for a reason
(`Harbor Supply --supplies--> Northwind Farms`); leave it alone and document the exception.

**`processing_queue`** - add `create-org-from-capture` and `extract-interactions` to the
`operation` CHECK. Nothing else changes. Doing it now avoids a second rebuild in Phase 1.

**`embeddings`** - **deferred to Phase 1, deliberately.** Widening
`entity_type` to include `'interaction'` is required for semantic recall over touches,
but Phase 0 has no interaction volume to search and this is the largest table of the
three. Phase 0's `/crm/[id]` timeline sorts by recency and filters with SQL `LIKE`,
which is adequate at Rolodex scale. Flag it in the Phase 1 ticket so it is not forgotten.

### 4.2 New tables

```sql
CREATE TABLE IF NOT EXISTS contact_channels (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('email','phone','handle','url','address')),
  value TEXT NOT NULL,             -- as entered, for display
  normalized_value TEXT NOT NULL,  -- for matching
  label TEXT,                      -- 'work', 'personal', 'IG'
  is_primary INTEGER DEFAULT 0,
  verified INTEGER DEFAULT 0,      -- set true once we have received from it
  metadata TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, kind, normalized_value)
);

CREATE INDEX IF NOT EXISTS idx_contact_channels_lookup
  ON contact_channels(user_id, normalized_value);
CREATE INDEX IF NOT EXISTS idx_contact_channels_entity
  ON contact_channels(entity_id, kind);
```

`UNIQUE(user_id, kind, normalized_value)` is the inbound resolver: one address maps to
exactly one entity. A shared `info@` address belonging to an org is correct and expected.

```sql
CREATE TABLE IF NOT EXISTS interactions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_id TEXT REFERENCES entities(id) ON DELETE CASCADE,   -- counterparty, NULL if unresolved
  venture_id TEXT REFERENCES entities(id) ON DELETE SET NULL, -- SNAPSHOT at insert time, never a lookup (see 6.3)
  deal_id TEXT,                                               -- Phase 2, intentionally no FK yet
  direction TEXT NOT NULL DEFAULT 'in'
    CHECK (direction IN ('in','out','internal')),
  channel TEXT NOT NULL DEFAULT 'note'
    CHECK (channel IN ('email','call','sms','dm','meeting','event','note','other')),
  occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
  subject TEXT,
  body TEXT,
  source_type TEXT,   -- 'note' | 'capture' | 'calendar' | 'email' | 'manual' | 'event_capture'
  source_id TEXT,
  dedup_key TEXT NOT NULL,
  metadata TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, dedup_key)
);

CREATE INDEX IF NOT EXISTS idx_interactions_user_time
  ON interactions(user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_interactions_entity
  ON interactions(entity_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_interactions_venture
  ON interactions(venture_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_interactions_source
  ON interactions(source_type, source_id);
```

`entity_id` is nullable on purpose: an inbound email from an unknown address should be
stored, not dropped, and resolved later.

`venture_id` is a snapshot, not a derived value. Section 6.3 explains why, and that
reason must survive into a comment on the column: resolving it by walking the current
`part_of` edge would silently rewrite history every time a product changes venture.

### 4.3 Column add (no rebuild)

```sql
ALTER TABLE projects ADD COLUMN venture_id TEXT REFERENCES entities(id);
CREATE INDEX IF NOT EXISTS idx_projects_venture ON projects(venture_id);
```

A plain `ADD COLUMN` with no CHECK, so SQLite takes it directly. This is how a project is
attached to a venture and how it moves between them. See 6.1 for why projects stay in
their own table rather than being mirrored into the entity graph.

---

## 5. Pure modules (the testable core)

Following the repo's existing pattern of keeping logic pure and DB-free
(`src/lib/entities/resolve.ts`, `src/lib/share/parse.ts`, `src/lib/annotations/intents.ts`).

### 5.1 `src/lib/crm/channels.ts`

```ts
export type ChannelKind = 'email' | 'phone' | 'handle' | 'url' | 'address';
export function normalizeChannelValue(kind: ChannelKind, raw: string): string;
```

- `email`: trim, lowercase. **Do not strip plus-tags.** `a+farm@x.com` and `a@x.com` are
  routinely different routing targets, and collapsing them would merge two contacts.
- `phone`: digits only, keep a leading `+`, assume `+1` for 10-digit input.
- `handle`: lowercase, strip a leading `@`.
- `url`: lowercase host, drop scheme, `www.`, and trailing slash.
- `address`: collapse whitespace, lowercase. Matching on addresses is advisory only.

Returns `""` for unusable input; callers must reject empty.

### 5.2 `src/lib/crm/dedup.ts`

```ts
export function buildInteractionDedupKey(i: {
  channel: string;
  occurredAt: string;
  entityId?: string | null;
  subject?: string | null;
  externalId?: string | null;
}): string;
```

Precedence:

1. `externalId` present -> `"{channel}:{externalId}"`. RFC822 Message-ID for email,
   iCal UID plus start time for calendar. Exact and cheap.
2. Otherwise -> `"{channel}:{entityId ?? 'unknown'}:{YYYY-MM-DD}:{slug(subject)}"`.

The date bucket is the day, not the timestamp. That is what collapses four identical
"meeting with Dana Okonkwo" entries logged minutes apart into one row, while still
allowing two genuinely separate calls with different subjects on the same day.

Must be pure and idempotent, with a round-trip test in the style of
`tests/lib/share/parse.test.ts`.

### 5.3 `src/lib/crm/metadata.ts`

Typed read and write helpers over `entities.metadata`, namespaced so they never collide
with the `{ aliases: [...] }` that `upsertEntity` writes on insert.

```jsonc
{
  "aliases": ["..."],              // existing, owned by the entity layer

  "is_venture": true,
  "venture": {
    "slug": "cedar-line",
    "sending_identity": { "email": "...", "display_name": "...", "signature": "..." },
    "voice": "Short. Direct. Do not drag on.",
    "compliance_rules": [
      "No health or therapeutic claims.",
      "Never describe proprietary process details in outbound."
    ],
    "offers": [{ "sku": "...", "name": "...", "price": "..." }]
  },

  "compartments": ["cannabis"],
  "resolution": "unresolved",
  "resolution_hint": { "met_at": "MycoFest 2026", "said": "...", "venture_id": "..." },
  "merge_candidate": { "target_entity_id": "...", "confidence": 0.82, "reason": "..." },
  "name_locked": true,

  "crm": {
    "relationship_stage": "prospect",
    "owner": null,
    "last_contacted_at": null,
    "next_action_at": null
  }
}
```

**Convention decisions, each chosen to avoid a backfill:**

- **Absent `resolution` means `confirmed`.** Every entity extraction has ever created
  lacks the key. Treating absent as `unresolved` would flag the entire existing graph.
  Only event capture writes `"unresolved"` explicitly.
- **Absent `compartments` means `["public"]`.** No implicit secrecy, and no backfill.
- **`is_venture` is checked with `=== true`**, never truthiness, so a stray string
  cannot promote an entity.
- **`name_locked` defaults false.** Only the seed script and manual edits set it.

### 5.4 Merge-confidence gate

Extend `src/lib/entities/resolve.ts` rather than replacing it. Add:

```ts
export type MergeVerdict =
  | { action: 'merge'; confidence: number }
  | { action: 'flag';  confidence: number; reason: string }
  | { action: 'separate'; reason: string };

export function assessMerge(existing, incoming): MergeVerdict;
```

Rules, in order:

1. **Never merge into or out of an `unresolved` entity.** Always `separate`.
   "Rascal" and "Matt in Carlisle" must not fuse with anything automatically.
2. **Never merge when a conflicting verified channel exists** (both sides have a
   verified email and they differ). Always `separate`.
3. **Never auto-merge across `entity_type`** (person into org). `flag`.
4. **Exact `normalized_key` match, same type, no channel conflict** -> `merge`.
5. **Key match only because a suffix token was stripped** (that is,
   `normalizeEntityKey(a) === normalizeEntityKey(b)` but the raw token sequences differ)
   -> `flag`, do not merge. This is the Northwind Farms / Northwind Holdings case.

`flag` writes `metadata.merge_candidate` on the *new* entity and lets both rows exist.
`/crm` surfaces a review list. Merges execute through `entity_aliases`, which is what
makes them reversible.

**This changes existing background behavior.** `ingestSourceEntities` currently merges on
key match unconditionally via `findEntityIdByKey`. Routing it through `assessMerge`
means notes will start producing separate entities where they previously fused. That is
the correct trade for a CRM and should be called out in the PR description.

#### Scope of the gate (open question 3, resolved)

The gate applies **everywhere, including background note extraction**, but only rule 5
changes existing behavior.

The alternative considered was applying it only to interactive CRM creates and leaving
`ingestSourceEntities` as-is. That was rejected: the CRM reads the same `entities` table
that background extraction writes to, so the CRM's correctness would be capped by its
loosest writer. Note extraction would keep fusing Northwind Farms into Northwind Holdings
and the CRM would inherit a merge it never sanctioned, with no record that it happened.
Two views of one table disagreeing is worse than either policy alone.

The cost is bounded because **rules 1 through 4 preserve today's behavior exactly**. An
exact `normalized_key` match on the same type with no channel conflict still auto-merges,
which is the overwhelmingly common case. The only newly-separated case is rule 5, where
the key match was *manufactured* by suffix stripping. That subset is narrow and
detectable.

**Measure the blast radius before enabling it.** Ship
`scripts/audit-merge-candidates.ts`, read-only, which walks existing entities and reports
how many pairs rule 5 would have flagged and which ones. Run it against real data and put
the number in the implementation PR. If it comes back large, the finding is that the
existing graph has more wrong merges than expected, which is an argument for the gate
rather than against it, but it changes how much review-queue UI Phase 0 needs.

### 5.5 `name_locked`

In `upsertEntity`, before calling `pickCanonicalName`:

```ts
const locked = readMetadata(current).name_locked === true;
const canonical = locked ? current.canonical_name : pickCanonicalName(current.canonical_name, e.name);
```

Also skip the `entity_type` overwrite when locked. Roughly six lines, one test.

---

## 6. Venture, product and project structure

**Decision (open question 1, resolved):** Sable Labs is the venture. Harvest Box is a
`product` entity attached to it. But the attachment is a **relationship, not an
ownership**, because products move between ventures.

### 6.1 Where each thing lives

| Concept | Storage | Why |
|---|---|---|
| Venture | `entities` with `entity_type='org'`, `metadata.is_venture=true` | Gets the graph, timeline, mentions, and metadata config for free |
| Product | `entities` with `entity_type='product'` | Same. Already in the `entity_type` CHECK. |
| Project | **the existing `projects` table**, plus a new `venture_id` column | A project already owns notes, tasks, collaborators, and health. Mirroring it into the graph would create two homes for one object, which is the exact duplication this design exists to avoid. |

So there is **no `project` entity type in CRM use**, even though the CHECK allows one.
`entity_type='project'` rows created by past extraction stay as they are; they are
knowledge-graph nodes, not the app's projects. Document this, because the collision of
names is a trap.

### 6.2 Membership is an edge, and it is movable

Product to venture is a single `part_of` edge:

```
Harvest Box --part_of--> Sable Labs
```

Moving a product is: delete the old `part_of` edge, insert the new one. It is one
transaction, it is reversible, and `entity_edges`' `UNIQUE(source, target, edge_type)`
makes a duplicate impossible. A product with no `part_of` edge is unassigned, which is a
valid state and should render as such rather than being hidden.

**A product may belong to exactly one venture at a time.** Enforced in the service layer,
not the schema, since the UNIQUE constraint keys on the pair rather than the source. The
move helper deletes any existing `part_of` edge from that product before inserting.

Project to venture is `projects.venture_id`, a nullable FK to `entities(id)`. Moving is
an `UPDATE`. `ALTER TABLE projects ADD COLUMN venture_id TEXT REFERENCES entities(id)` is
a plain add with no CHECK, so no rebuild.

### 6.3 The rule that makes moves safe

**History never moves with the product.**

When Harvest Box moves from Sable Labs to a new venture, every interaction, and later every
deal, that happened while Harvest Box sat under Sable Labs must still read as
Sable Labs. Revenue, compliance context, and "what happened in Cedar Line this
month" all break otherwise.

Therefore `interactions.venture_id` is a **snapshot written at insert time, never a
lookup**. The same will apply to `deals.venture_id` in Phase 2. Nothing in the read path
may resolve a venture by walking the current `part_of` edge.

This is easy to get wrong later by "helpfully" replacing the stored column with a join.
Put the reason in a comment on the column and in the structure module.

### 6.4 `src/lib/crm/structure.ts`

Two storages, one interface, so the UI and API never branch on it:

```ts
export type MemberKind = 'product' | 'project';

export async function listVentures(userId: string): Promise<VentureSummary[]>;
export async function listVentureMembers(userId: string, ventureId: string):
  Promise<{ products: Entity[]; projects: Project[] }>;
export async function createVenture(userId: string, input: VentureInput): Promise<Entity>;
export async function createProduct(userId: string, input: ProductInput & { ventureId?: string }): Promise<Entity>;
export async function moveToVenture(
  userId: string, kind: MemberKind, id: string, ventureId: string | null
): Promise<void>;
```

`moveToVenture` with `ventureId: null` unassigns. It must reject a target that is not
`is_venture === true`, and reject moving a venture into itself or into another venture
(ventures do not nest in Phase 0).

### 6.5 Seed

`scripts/seed-ventures.ts`, run with `npx tsx scripts/seed-ventures.ts`, added to
`package.json` as `seed:ventures`.

Seven ventures:

| Venture | normalized_key | Notes |
|---|---|---|
| Northwind Farms | `northwindfarms` | |
| Cedar Line | `cedarline` | compliance: no health claims |
| Sable Labs | `sablelabs` | co-pack |
| Ridgeway Collective | `ridgewaycollective` | compliance: no member-discount language to institutions |
| third-coast.studio | `thirdcoaststudio` | |
| Meridian Engineering | `meridianengineering` | |
| Starter Kits | `starterkits` | |

Plus one product: **Harvest Box**, `part_of` Sable Labs.

**The script seeds the known starting set only.** Additional ventures, products, and
projects are created through the API and UI from item 9, not by editing this script.
That is the whole point of building create-and-move in Phase 0. The script stays a
bootstrap, never a registry.

**It must adopt, not insert.** Several of these names almost certainly already exist as
extracted `org` entities with real `mention_count` and mention history. So:

1. Compute `normalizeEntityKey(name)`.
2. Look the key up the same way `findEntityIdByKey` does (entity, then alias).
3. If found: **merge metadata into the existing row**, set `entity_type`,
   `is_venture = true`, `name_locked = true`. Preserve `canonical_name`,
   `mention_count`, `first_seen_at`, and every existing metadata key.
4. If not found: insert with `mention_count = 0`.
5. Print a table of adopted vs created. Never destructive.

Re-running is a no-op. There is a test for that.

### 6.6 Keeping ventures out of the noise heuristics

Ventures will be mentioned in nearly every note. Exclude them from:

- stale-contact checks (Phase 3), or every venture reads as a neglected contact;
- automatic merge, which `name_locked` already achieves via rule 0 in 5.4.

Leave them **in** co-occurrence edge building. A venture accumulating `related` edges to
the people mentioned alongside it is the signal that makes the venture timeline useful on
day one.

## 7. Surfaces

### API

| Route | Purpose |
|---|---|
| `GET /api/crm/contacts` | `?venture=&type=&compartment=&resolution=&q=&limit=`. Excludes `unresolved` unless `resolution=unresolved` or `all`. |
| `GET /api/crm/contacts/[id]` | Brief: entity, channels, compartments, venture roles from edges, merged timeline of `entity_mentions` and `interactions`, `merge_candidate` if any. |
| `POST /api/crm/interactions` | Body `{ entityId?, ventureId?, direction, channel, occurredAt, subject, body, sourceType, sourceId, externalId? }`. Computes `dedup_key` server-side, `INSERT OR IGNORE`, returns `{ interaction, deduped: boolean }`. |
| `GET/POST/DELETE /api/crm/contacts/[id]/channels` | Channel CRUD. POST normalizes and 409s on a cross-entity collision, naming the conflicting entity. |
| `GET /api/crm/ventures` | Ventures with contact, product, project, and interaction counts. |
| `POST /api/crm/ventures` | Create a venture. Sets `is_venture`, `name_locked`, `entity_type='org'`. Adopts an existing entity on key collision rather than 409ing, same logic as the seed. |
| `GET /api/crm/products` | `?venture=` filter. Unassigned products included under a null venture. |
| `POST /api/crm/products` | Create a product, optionally with `ventureId`. |
| `PUT /api/crm/structure/move` | Body `{ kind: 'product' \| 'project', id, ventureId \| null }`. Swaps the `part_of` edge or updates `projects.venture_id`. Rejects a non-venture target and rejects nesting a venture. |

Extend `/api/entities/[id]` where it already does the work rather than duplicating its
timeline query.

### UI

- `/crm` - contact list. Filter chips for venture, type, compartment. A distinct
  "Needs review" tab for `resolution=unresolved` and `merge_candidate`.
- `/crm/[entityId]` - the brief. Header with name, type, channels, compartment badges,
  venture role badges. Merged timeline. Edges panel.
- `/crm/ventures` - one card per venture with counts, each linking to a filtered contact
  list. A "New venture" action.
- `/crm/ventures/[id]` - venture detail: its products, its projects, its contacts, its
  timeline. This is where a product or project is moved, via a venture picker on each
  row. Moving shows a confirmation naming what stays put: past interactions keep their
  original venture (6.3).
- Unassigned products render in their own group rather than being hidden.

Follow the existing dashboard layout group and the mobile rules already in the codebase
(56px touch targets, responsive spacing).

---

## 8. Tests

New:

- `tests/lib/crm/channels.test.ts` - normalization per kind, plus-tag preservation,
  empty-input rejection.
- `tests/lib/crm/dedup.test.ts` - externalId precedence, day bucketing, idempotency,
  the four-identical-captures case collapsing to one.
- `tests/lib/crm/metadata.test.ts` - absent `resolution` reads as `confirmed`, absent
  `compartments` reads as `["public"]`, `is_venture` strict-equality, round-trip
  preserves unknown keys.
- `tests/lib/crm/merge-gate.test.ts` - all five `assessMerge` rules, with
  Northwind Farms / Northwind Holdings as a named case.
- `tests/scripts/seed-ventures.test.ts` - adopt path preserves `mention_count` and
  existing metadata; second run is a no-op.

- `tests/lib/crm/structure.test.ts` - `moveToVenture` swaps rather than duplicates the
  `part_of` edge; moving to `null` unassigns; a non-venture target is rejected; a venture
  cannot be nested in a venture; a product ends up in exactly one venture after two
  consecutive moves.
- `tests/lib/crm/history-stability.test.ts` - the rule from 6.3, stated as a test:
  log an interaction against a product under venture A, move the product to venture B,
  assert the interaction still reads venture A. This is the one that will catch a future
  refactor turning the snapshot into a join.

Extend:

- `tests/lib/entities/resolve.test.ts` - `name_locked`.
- `tests/lib/entities/store.test.ts` - `upsertEntity` routes through `assessMerge`.

---

## 9. Acceptance criteria

1. `npm run typecheck`, `npm run lint`, and `npm test` pass.
2. The migration is idempotent; running it twice is clean.
3. After the migration, `entity_edges` retains every pre-existing row and accepts
   `edge_type = 'partner'`.
4. `npx tsx scripts/seed-ventures.ts` twice yields seven `is_venture` entities, adopts
   rather than duplicates any pre-existing ones, and preserves their `mention_count`.
5. An email address entered on two different entities returns 409 naming the conflict,
   not a silent overwrite.
6. Posting the same interaction payload twice returns `deduped: true` and leaves one row.
7. `/crm/[entityId]` for a person with a venture role shows the role badge, the channels,
   and a timeline merging note mentions with interactions in one chronological list.
8. Creating a note that mentions "Northwind Holdings" when "Northwind Farms" exists
   produces two entities, the new one carrying `merge_candidate`, and both appear under
   "Needs review".
9. Harvest Box can be moved from Sable Labs to another venture and back, ending with exactly
   one `part_of` edge each time.
10. An interaction logged before that move still reports its original venture afterward.
11. A venture, a product, and a project can each be created from the UI and assigned to a
    venture without editing the seed script.
12. `scripts/audit-merge-candidates.ts` runs read-only against real data and reports a
    count, with the number recorded in the implementation PR.

---

## 10. Decisions and remaining questions

### Resolved

**1. Harvest Box and the venture taxonomy.** Sable Labs is the venture; Harvest Box is a `product`
entity attached by a `part_of` edge. Products are movable between ventures, so the
attachment is modeled as a swappable edge rather than ownership, and historical
attribution is snapshotted at write time so a move never rewrites the past. Ventures,
products, and projects are created on an ongoing basis through the API and UI; the seed
script only bootstraps the known seven. See section 6.

**2. Compartments in Phase 0.** Display and filter only, no blocking. There is no send
path and no prompt path touching contacts in Phase 0, so enforcement would have nothing
to enforce against and would ship untested. It becomes real in Phase 1 alongside intake,
which is the first thing that puts contact data in front of a model.

**3. Merge-gate scope.** Applies everywhere including background extraction, with rules
1 through 4 preserving today's behavior exactly, so only the suffix-collision case
changes. Ship a read-only audit script first and put the blast-radius number in the
implementation PR. Full reasoning in 5.4.

### Still open

**4. Sending identity per venture.** The BCC-dropbox design in Phase 1 resolves the
venture from the *From* address, which requires each venture to have a distinct sending
address in `venture.sending_identity.email`. Are all seven distinct today, or do some
share a mailbox? If they share, the resolver needs a fallback and the seed should leave
the field null rather than guess. **Not blocking Phase 0** - the field is stored and
unused until Phase 1.

## 11. What Phase 0 deliberately leaves broken

Stated plainly so it is not discovered later:

- No semantic search over interaction bodies (`embeddings` CHECK, 2.2b).
- No intake. Every interaction in Phase 0 is entered by hand or via the API.
- No compliance enforcement. Rules are stored, nothing reads them.
- No deals. `interactions.deal_id` exists as a column and stays null.
- Single-tenant. Everything is `user_id` scoped; a shared team CRM needs
  `project_collaborators` generalized, which is larger than this whole phase.
- Ventures do not nest. A venture cannot contain another venture in Phase 0. If a
  holding-company structure is needed later, it is a `part_of` edge between two venture
  entities plus a recursion guard in `listVentureMembers`.
- A product belongs to one venture at a time. A product genuinely shared across two
  ventures (a co-pack sold under two labels) has no representation yet; the workaround is
  two product entities.

---

## 12. Implementation notes

Written after the build. Where the code diverges from the design above, this
section is correct and the design is the record of the reasoning.

### Changed during implementation

- **The migration DDL lives in `src/lib/crm/schema.ts`**, not in the script.
  `scripts/migrate-add-crm-phase-0.ts` is a thin CLI over
  `applyCrmPhase0Migration(db)`. This was the only way to execute the CHECK
  rebuilds against an in-memory database in a test rather than reasoning about
  them and finding out in production.

- **`src/lib/db/schema.ts` now mirrors the entity layer.** That module had
  drifted: `entities`, `entity_aliases`, `entity_mentions` and `entity_edges`
  existed only inside `scripts/migrate-add-entity-layer.ts`, so the "canonical"
  schema could not produce a database the migration could run against. Nothing
  imports the schema string at runtime, so the blast radius is zero. The CRM
  tables are deliberately NOT mirrored there: the migration owns them, matching
  how every other post-launch table in this repo is handled.

- **`assessMerge` gained rule 0** (a `name_locked` entity accepts only an exact
  match). Largely redundant with rule 5, kept explicit so a venture's protection
  does not depend on the suffix list happening to cover the case.

- **A flagged entity stores its strict key.** Section 5.4 did not say what
  `normalized_key` a flagged row gets. It cannot reuse the loose key, which the
  existing row already holds under a UNIQUE constraint, so it stores
  `normalizeEntityKeyStrict(name)` — precisely the value that distinguishes it
  from the row it was flagged against.

- **`GET /api/crm/ventures/[id]/members`** was added. The venture detail page
  otherwise needed two fetches and a venture filter on `/api/projects` that does
  not exist. One endpoint through the structure module keeps the two-storage
  split invisible to callers, which was the point of the module.

- **`seedVentures` lives in `src/lib/crm/seed.ts`**, same reasoning as the
  migration: the adopt path is the part worth testing.

### Verified

- 132 tests pass across the CRM and entity suites (8 files), including 12 that apply the
  real schema and real migration to an in-memory libsql database, and 23 that
  run the structure module's actual SQL rather than asserting on mocks.
- `npx tsc --noEmit` reports no errors in `src/` or `scripts/`.
- ESLint is clean on every file added or changed.
- `next build` compiles, typechecks, and emits all 8 API routes and 4 pages.

### Known pre-existing failures, untouched

14 test files (39 tests) fail on `origin/main` and still fail here: attachments,
task routes, recommendations, offline sync, link-scraper and project API suites.
None are in code this phase touches. They are called out rather than fixed so
the number is not mistaken for regression.

`npm run build` also cannot run in a bare checkout, because its `prebuild` hook
runs `scripts/migrate.ts` against a live database. `npx next build` with
credentials present is the equivalent, and is what was run here.

### Still not done, as designed

No intake, no deals, no compliance enforcement, no semantic search over
interaction bodies. Section 11 lists these with reasons. Compartments are stored
and displayed but nothing is blocked, which is Phase 1's job.
