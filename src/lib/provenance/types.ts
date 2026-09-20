/**
 * Who wrote a row, and which single operation produced it.
 *
 * Before this, nothing in `notes`, `captures`, `tasks` or `reminders` recorded
 * an author. The `source_type` on a stream row was synthesised in SQL at read
 * time — the literal string `'manual'` for every capture, note and reminder,
 * whoever wrote it — so a note written by an MCP key was byte-identical to one
 * the user typed, and no amount of UI could tell them apart.
 *
 * The information was always there: `validateApiKey` returns `keyId` and
 * `keyName` on every call and every tool handler received it, used `userId`,
 * and dropped the rest. These columns are where the rest goes.
 *
 * This module imports **nothing**, deliberately. It is the shared vocabulary
 * for the MCP tools (which run outside Next.js against their own libsql
 * client), the API routes, and the browser — so it must not reach for a
 * database client or anything that constructs one at import time. The same
 * reasoning keeps `chat/item-types.ts` apart from `chat/item-context.ts`.
 */

/**
 * The kinds of thing that write content.
 *
 * Deliberately about the *writer*, not the channel: sharing a link from a
 * phone is a human writing through the share target, and the same endpoint
 * authenticated with a bearer key is an agent. The channel belongs in
 * `metadata`, which already carries `source: "share_target"`.
 */
export const SOURCE_ACTORS = [
  "human",
  "mcp_key",
  "agent",
  "skill",
  "import",
] as const;

export type SourceActor = (typeof SOURCE_ACTORS)[number];

/** Actors whose writes the user did not personally type. */
export function isAutomated(actor: SourceActor): boolean {
  return actor !== "human";
}

export interface ProvenanceStamp {
  actor: SourceActor;
  /**
   * `mcp_api_keys.id` for `mcp_key` writes, otherwise null.
   *
   * Stored without a foreign key on purpose. Revoking a key six months from
   * now must not cascade away the history of everything it ever wrote;
   * provenance should outlive the credential that produced it.
   */
  keyId: string | null;
  /**
   * The writer's display name *at the time of writing* — the key's name, the
   * agent's role, the skill's id. Denormalised for the same reason: a revoked
   * key's rows still need to read "Claude Desktop" rather than a dead id.
   */
  label: string | null;
  /**
   * The one operation that produced this row, shared by every row that
   * operation wrote. Null for writes that have no batch to belong to.
   */
  runId: string | null;
}

/**
 * What a row with no stamp means.
 *
 * Every row written before this existed has NULL in all four columns, and the
 * overwhelming majority of them were typed by the user. Reading NULL as
 * "human" is therefore both the correct default and the one that needs no
 * backfill. Session-cookie API routes also leave the columns NULL rather than
 * writing `'human'` into every insert site in the app — same meaning, far
 * smaller diff. `normalizeActor` is the single place that decision lives.
 */
export const HUMAN_STAMP: ProvenanceStamp = {
  actor: "human",
  keyId: null,
  label: null,
  runId: null,
};

export function normalizeActor(raw: string | null | undefined): SourceActor {
  if (!raw) return "human";
  return (SOURCE_ACTORS as readonly string[]).includes(raw)
    ? (raw as SourceActor)
    : "human";
}

/** The four columns, in the order `stampValues` returns them. */
export const PROVENANCE_COLUMNS = [
  "source_actor",
  "source_key_id",
  "source_label",
  "source_run_id",
] as const;

/**
 * Column list for an INSERT, ready to interpolate.
 *
 * Callers append this to their column list and `stampValues()` to their
 * arguments, so the two can never drift out of order at a call site.
 */
export function stampColumns(): string {
  return PROVENANCE_COLUMNS.join(", ");
}

/** Placeholders matching `stampColumns()`. */
export function stampPlaceholders(): string {
  return PROVENANCE_COLUMNS.map(() => "?").join(", ");
}

export function stampValues(
  stamp: ProvenanceStamp
): [string, string | null, string | null, string | null] {
  return [stamp.actor, stamp.keyId, stamp.label, stamp.runId];
}

/** A row as it comes back from any of the four content tables. */
export interface ProvenanceRow {
  source_actor?: string | null;
  source_key_id?: string | null;
  source_label?: string | null;
  source_run_id?: string | null;
}

export function readStamp(row: ProvenanceRow): ProvenanceStamp {
  return {
    actor: normalizeActor(row.source_actor),
    keyId: row.source_key_id ?? null,
    label: row.source_label ?? null,
    runId: row.source_run_id ?? null,
  };
}
