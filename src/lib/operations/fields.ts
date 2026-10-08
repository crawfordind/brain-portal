/**
 * Reading and writing `tasks.metadata.ops`.
 *
 * Pure and dependency-free (bar the types), so the API routes, the MCP tools
 * and the tests share one interpretation of the JSON.
 *
 * Three rules:
 *
 * - **Absent means ordinary.** No `ops` key = a confirmed action the user owns.
 *   That is what every task written before this existed actually is, so no
 *   backfill is needed and nothing existing changes meaning.
 * - **Unknown keys survive.** `metadata` is shared with other subsystems; a
 *   write here merges into `ops` and never touches a sibling key.
 * - **Garbage degrades, it does not throw.** A malformed value written by an
 *   import or a model is dropped field by field, not allowed to break a page.
 */

import {
  OPS_DIRECTIONS,
  OPS_KINDS,
  OPS_OWNERS,
  OPS_STATES,
  type OpsFields,
  type OpsKind,
  type OpsOwner,
  type ResolvedOps,
} from "./types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TEXT = 500;
const MAX_OPTIONS = 8;

function parseObject(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw !== "string" || !raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function oneOf<T extends string>(list: readonly T[], value: unknown): T | undefined {
  return typeof value === "string" && (list as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().slice(0, MAX_TEXT);
  return trimmed || undefined;
}

/** Accepts `YYYY-MM-DD` or an ISO timestamp; stores the date part. */
export function normalizeDate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const head = value.trim().slice(0, 10);
  if (!DATE_RE.test(head)) return undefined;
  const [y, m, d] = head.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d ? head : undefined;
}

/** Strictly read the `ops` object out of a task's metadata. */
export function readOps(metadata: unknown): OpsFields {
  const raw = parseObject(parseObject(metadata).ops);
  const fields: OpsFields = {};

  const kind = oneOf(OPS_KINDS, raw.kind);
  if (kind) fields.kind = kind;
  const state = oneOf(OPS_STATES, raw.state);
  if (state) fields.state = state;
  const owner = oneOf(OPS_OWNERS, raw.owner);
  if (owner) fields.owner = owner;
  const direction = oneOf(OPS_DIRECTIONS, raw.direction);
  if (direction) fields.direction = direction;

  for (const key of [
    "counterparty",
    "counterparty_entity_id",
    "blocked_by",
    "why",
    "consequence",
    "updated_at",
  ] as const) {
    const value = text(raw[key]);
    if (value) fields[key] = value;
  }

  const expected = normalizeDate(raw.expected_at);
  if (expected) fields.expected_at = expected;

  if (Array.isArray(raw.options)) {
    const options = raw.options
      .map(text)
      .filter((o): o is string => !!o)
      .slice(0, MAX_OPTIONS);
    if (options.length) fields.options = options;
  }

  const source = parseObject(raw.source);
  if ((source.type === "capture" || source.type === "note") && text(source.id)) {
    fields.source = { type: source.type, id: text(source.id)! };
  }

  return fields;
}

/**
 * Who moves next, when nobody said.
 *
 * Waiting means someone else owes the next move; everything else — a decision,
 * an action, a promise the user made — is the user's. A commitment someone
 * made *to* the user is theirs to deliver.
 */
export function defaultOwner(kind: OpsKind, fields: OpsFields): OpsOwner {
  if (kind === "waiting") return "other";
  if (kind === "commitment" && fields.direction === "they_owe") return "other";
  return "me";
}

export function resolveOps(fields: OpsFields): ResolvedOps {
  const kind = fields.kind ?? "action";
  return {
    ...fields,
    kind,
    state: fields.state ?? "confirmed",
    owner: fields.owner ?? defaultOwner(kind, fields),
    blocked: !!fields.blocked_by,
  };
}

/**
 * A patch to `ops`. `null` deletes a key, `undefined` leaves it alone —
 * the same contract as `writeEntityMetadata` in the CRM.
 */
export type OpsPatch = { [K in keyof OpsFields]?: OpsFields[K] | null };

export type PatchResult =
  | { ok: true; patch: OpsPatch }
  | { ok: false; error: string };

const PATCHABLE = [
  "kind",
  "state",
  "owner",
  "counterparty",
  "counterparty_entity_id",
  "expected_at",
  "blocked_by",
  "direction",
  "why",
  "options",
  "consequence",
] as const;

/**
 * Validate an untrusted patch (from the API body or an MCP call). Rejects an
 * invalid enum value outright rather than dropping it, because silently
 * ignoring "kind: waitng" would tell the caller the move succeeded.
 */
export function validateOpsPatch(input: unknown): PatchResult {
  const body = parseObject(input);
  const patch: OpsPatch = {};

  for (const key of PATCHABLE) {
    if (!(key in body)) continue;
    const value = body[key];
    if (value === null || value === "") {
      patch[key] = null;
      continue;
    }
    switch (key) {
      case "kind": {
        const v = oneOf(OPS_KINDS, value);
        if (!v) return { ok: false, error: `kind must be one of ${OPS_KINDS.join(", ")}` };
        patch.kind = v;
        break;
      }
      case "state": {
        const v = oneOf(OPS_STATES, value);
        if (!v) return { ok: false, error: `state must be one of ${OPS_STATES.join(", ")}` };
        patch.state = v;
        break;
      }
      case "owner": {
        const v = oneOf(OPS_OWNERS, value);
        if (!v) return { ok: false, error: `owner must be one of ${OPS_OWNERS.join(", ")}` };
        patch.owner = v;
        break;
      }
      case "direction": {
        const v = oneOf(OPS_DIRECTIONS, value);
        if (!v) return { ok: false, error: `direction must be one of ${OPS_DIRECTIONS.join(", ")}` };
        patch.direction = v;
        break;
      }
      case "expected_at": {
        const v = normalizeDate(value);
        if (!v) return { ok: false, error: "expected_at must be a date (YYYY-MM-DD)" };
        patch.expected_at = v;
        break;
      }
      case "options": {
        if (!Array.isArray(value)) return { ok: false, error: "options must be a list of strings" };
        patch.options = value.map(text).filter((o): o is string => !!o).slice(0, MAX_OPTIONS);
        break;
      }
      default: {
        const v = text(value);
        if (v === undefined) return { ok: false, error: `${key} must be text` };
        patch[key] = v;
      }
    }
  }

  return { ok: true, patch };
}

/**
 * Merge a patch into a task's whole metadata JSON and serialize it. Sibling
 * keys outside `ops` are untouched. Returns the previous `ops` too, so a caller
 * can offer an exact undo.
 */
export function applyOpsPatch(
  metadata: unknown,
  patch: OpsPatch,
  now: Date = new Date()
): { metadata: string; previous: OpsFields; next: OpsFields } {
  const whole = parseObject(metadata);
  const previous = readOps(whole);
  const next: Record<string, unknown> = { ...parseObject(whole.ops) };

  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key];
    else if (value !== undefined) next[key] = value;
  }

  // Changing what something *is* resets the owner unless the caller set one,
  // or "move this to waiting on Will" would leave it owned by "me".
  if (patch.kind !== undefined && patch.owner === undefined) delete next.owner;

  next.updated_at = now.toISOString();
  const cleaned = readOps({ ops: next });
  whole.ops = cleaned;
  return { metadata: JSON.stringify(whole), previous, next: cleaned };
}

/**
 * The patch that exactly restores `previous`: every key it lacked is deleted,
 * every key it had is put back. Used by the undo the UI offers.
 */
export function restorePatch(previous: OpsFields): OpsPatch {
  const patch: OpsPatch = {};
  for (const key of PATCHABLE) {
    const value = previous[key];
    (patch as Record<string, unknown>)[key] = value === undefined ? null : value;
  }
  return patch;
}
