/**
 * Building a provenance stamp for each kind of writer.
 *
 * Each subsystem already knows the one operation it is part of; these helpers
 * just name it consistently. An MCP key's run is derived from its write
 * cadence (`runTracker`); an agent's is the agent task; a skill's is the skill
 * execution; an import's is the import job. Same column, same meaning
 * everywhere: *the one operation that produced this row*.
 *
 * Nothing here imports a database client, so MCP tools, API routes and the
 * browser can all share it.
 */

export * from "./types";
export * from "./run";

import { runTracker } from "./run";
import { HUMAN_STAMP, type ProvenanceStamp } from "./types";

/**
 * Callers pass this shape rather than `AuthenticatedUser`, which would drag
 * `@/mcp/auth` — and through it a libsql client — into every importer.
 */
export interface KeyIdentity {
  keyId: string;
  keyName: string;
}

/**
 * Key ids that do not identify a real credential.
 *
 * `dev-fallback` is what `MCP_USER_ID` mode produces (see `src/mcp/auth.ts`),
 * and the share route passes an empty id when the caller authenticated with a
 * session cookie instead of a key — in which case the writer is the person,
 * not an agent, and the stamp must say so.
 */
const NON_KEY_IDS = new Set(["", "dev-fallback"]);

/**
 * Stamp for a write made through an MCP API key.
 *
 * `runIdOverride` comes from the `X-Brain-Run-Id` header when a client is
 * thoughtful enough to group its own job; it is adopted as the key's current
 * run so that later writes in the same window join it even if the client
 * stops sending the header.
 */
export function mcpKeyStamp(
  identity: KeyIdentity,
  runIdOverride?: string | null,
  now: number = Date.now()
): ProvenanceStamp {
  if (NON_KEY_IDS.has(identity.keyId)) return HUMAN_STAMP;

  const runId = runIdOverride
    ? runTracker.adopt(identity.keyId, runIdOverride, now)
    : runTracker.runFor(identity.keyId, now);

  return {
    actor: "mcp_key",
    keyId: identity.keyId,
    label: identity.keyName || "API key",
    runId,
  };
}

/** Stamp for content written by Brain Portal's own agent executor. */
export function agentStamp(
  agentTaskId: string,
  agentLabel?: string | null
): ProvenanceStamp {
  return {
    actor: "agent",
    keyId: null,
    label: agentLabel || "Agent",
    runId: agentTaskId ? `run_agent_${agentTaskId}` : null,
  };
}

/**
 * Stamp for content written by a skill.
 *
 * The execution id is the natural run: one `auto_triage_captures` pass that
 * converts forty captures is one operation, however many rows it touches.
 */
export function skillStamp(
  skillId: string,
  executionId?: string | null
): ProvenanceStamp {
  return {
    actor: "skill",
    keyId: null,
    label: skillId,
    runId: executionId ? `run_skill_${executionId}` : null,
  };
}

/** Stamp for a bulk import. One import job is one run, by definition. */
export function importStamp(source: string, jobId: string): ProvenanceStamp {
  return {
    actor: "import",
    keyId: null,
    label: source,
    runId: jobId ? `run_import_${jobId}` : null,
  };
}
