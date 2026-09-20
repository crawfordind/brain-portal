/**
 * Grouping a burst of writes into one "run".
 *
 * The flood that motivated this was not "an agent wrote things". It was *one
 * job* arriving as two hundred rows pretending to be two hundred separate
 * thoughts. Author alone does not fix that — you need to know which rows came
 * out of the same operation, so the feed can render them as one.
 *
 * ## Where a run id comes from
 *
 * The obvious answer — one id per request — is useless over the HTTP MCP
 * transport, which is stateless: one request *is* one tool call, so every row
 * would get its own run. The client could supply an id per job, and it may
 * (see `adopt`, wired to the `X-Brain-Run-Id` header), but most clients will
 * never bother and the ones that matter most are the ones nobody configured.
 *
 * So the default is derived server-side: **writes from the same key continue
 * the same run while the gap between them stays under `gapMs`.** It needs no
 * client cooperation, works with every integration that already exists, and
 * would have caught the incident this was built for.
 *
 * The window slides — each write extends the run — because a job that writes
 * steadily for four hours is one job. `maxRunMs` stops that from becoming an
 * unbounded run for a key that writes every few minutes forever.
 *
 * ## In-process, like the rate limiter
 *
 * State lives in a `Map`, exactly as `src/mcp/rate-limit.ts` keeps its token
 * buckets. A cold start or a second serverless instance splits one job into
 * two runs, which shows the user two collapsed rows instead of one. That is
 * the whole failure mode: it degrades toward today's behaviour rather than
 * toward anything wrong.
 *
 * Everything here is injectable so it can be tested against a fixed clock and
 * a counting id generator rather than wall time and randomness.
 */

/** Gap after which a key's next write starts a new run. */
export const DEFAULT_RUN_GAP_MS = 30 * 60 * 1000;

/** Hard ceiling on a single run, so a steady writer eventually rolls over. */
export const DEFAULT_MAX_RUN_MS = 6 * 60 * 60 * 1000;

/**
 * Above this many tracked keys, entries too old to continue are dropped. Runs
 * past `gapMs` can never be extended, so pruning them changes no behaviour.
 */
const PRUNE_THRESHOLD = 500;

export interface RunState {
  runId: string;
  /** When the run's first write landed. */
  startedAt: number;
  /** When its most recent write landed. */
  lastWriteAt: number;
}

export interface RunTrackerOptions {
  gapMs?: number;
  maxRunMs?: number;
  /** Injected in tests; defaults to a random, sortable-ish id. */
  generateId?: () => string;
}

export interface RunTracker {
  /**
   * The run id this key's write belongs to, starting a new run if the
   * previous one has lapsed. Records the write as part of that run.
   */
  runFor(keyId: string, now?: number): string;
  /**
   * Take a caller-supplied run id (the `X-Brain-Run-Id` header) and make it
   * this key's current run, so later writes in the same window join it even
   * if the client stops sending the header. Returns the id it adopted.
   */
  adopt(keyId: string, runId: string, now?: number): string;
  /** Read a key's run state without recording a write. */
  peek(keyId: string): RunState | undefined;
  /** Test helper: drop all state. */
  reset(): void;
  /** Test/diagnostic helper. */
  size(): number;
}

function defaultGenerateId(): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj?.randomUUID) {
    return `run_${cryptoObj.randomUUID().replace(/-/g, "").slice(0, 24)}`;
  }
  // Environments without WebCrypto still need *an* id; collisions here would
  // merely group two unrelated bursts, never lose a row.
  return `run_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Whether a write at `now` continues `state`'s run.
 *
 * Pure and exported so the policy can be tested directly, without driving it
 * through a tracker's mutable map.
 */
export function continuesRun(
  state: RunState,
  now: number,
  gapMs: number,
  maxRunMs: number
): boolean {
  if (now - state.lastWriteAt > gapMs) return false;
  if (now - state.startedAt > maxRunMs) return false;
  // A clock that jumped backwards should not extend a run indefinitely, but it
  // also should not split one; treat it as a continuation and let the
  // timestamps stand.
  return true;
}

export function createRunTracker(options: RunTrackerOptions = {}): RunTracker {
  const gapMs = options.gapMs ?? DEFAULT_RUN_GAP_MS;
  const maxRunMs = options.maxRunMs ?? DEFAULT_MAX_RUN_MS;
  const generateId = options.generateId ?? defaultGenerateId;

  const states = new Map<string, RunState>();

  function prune(now: number): void {
    if (states.size <= PRUNE_THRESHOLD) return;
    for (const [key, state] of states) {
      if (now - state.lastWriteAt > gapMs) states.delete(key);
    }
  }

  return {
    runFor(keyId: string, now: number = Date.now()): string {
      const existing = states.get(keyId);

      if (existing && continuesRun(existing, now, gapMs, maxRunMs)) {
        existing.lastWriteAt = now;
        return existing.runId;
      }

      prune(now);
      const runId = generateId();
      states.set(keyId, { runId, startedAt: now, lastWriteAt: now });
      return runId;
    },

    adopt(keyId: string, runId: string, now: number = Date.now()): string {
      const existing = states.get(keyId);

      if (existing?.runId === runId) {
        existing.lastWriteAt = now;
        return runId;
      }

      prune(now);
      states.set(keyId, { runId, startedAt: now, lastWriteAt: now });
      return runId;
    },

    peek(keyId: string): RunState | undefined {
      return states.get(keyId);
    },

    reset(): void {
      states.clear();
    },

    size(): number {
      return states.size;
    },
  };
}

/**
 * The process-wide tracker used by real write paths.
 *
 * The stdio MCP server and the Next.js server are separate processes and each
 * gets its own, which is correct: a key generally talks to one transport.
 */
export const runTracker: RunTracker = createRunTracker();
