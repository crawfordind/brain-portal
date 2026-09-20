/**
 * Tool-level authorization guard.
 *
 * Every MCP tool invocation must pass two checks:
 *   1. Scope check  — the authenticated key must hold the tool's required
 *      scope (or the wildcard `*`).
 *   2. Rate limit  — a token is consumed from the key's per-minute bucket.
 *
 * Tools obtain these via a `ToolContext` passed in at registration time,
 * instead of the previous bare `getUserId: () => string`. The context also
 * exposes `getUser()` / `getUserId()` for handlers that need them.
 */

import type { AuthenticatedUser } from "./auth";
import { hasScope } from "./auth";
import { consumeRateLimit } from "./rate-limit";
import { mcpKeyStamp, type ProvenanceStamp } from "@/lib/provenance";

export interface GuardOk {
  ok: true;
  userId: string;
  user: AuthenticatedUser;
  rateLimit: { remaining: number; limit: number };
}

export interface GuardError {
  ok: false;
  userId: string;
  error: {
    type: "scope" | "rate_limit";
    message: string;
    /** Scope that was missing (scope errors only). */
    scope?: string;
    /** Ms to wait before retrying (rate-limit errors only). */
    retryAfterMs?: number;
  };
}

export type GuardResult = GuardOk | GuardError;

export interface ToolContext {
  /** The authenticated user for this invocation. */
  getUser: () => AuthenticatedUser;
  /** Convenience: authenticated user id. */
  getUserId: () => string;
  /** Run scope + rate-limit checks. Returns a discriminated result. */
  guard: (scope: string) => GuardResult;
  /**
   * Provenance for a row this invocation writes: the key that wrote it, and
   * the run it belongs to.
   *
   * Every tool handler already received this — `AuthenticatedUser` carries
   * `keyId` and `keyName` — and every one of them used `userId` and threw the
   * rest away, which is why a note written by a key was indistinguishable
   * from one the user typed. Call this once per write and spread it into the
   * INSERT; see `src/lib/provenance`.
   */
  provenance: () => ProvenanceStamp;
}

export interface ToolContextOptions {
  /**
   * A run id supplied by the client (the `X-Brain-Run-Id` header), grouping
   * the writes of one job explicitly instead of letting the server infer the
   * grouping from write cadence.
   */
  runId?: string | null;
}

export function createToolContext(
  getUser: () => AuthenticatedUser,
  options: ToolContextOptions = {}
): ToolContext {
  return {
    getUser,
    getUserId: () => getUser().userId,
    guard: (scope: string) => runGuard(getUser(), scope),
    provenance: () => {
      const user = getUser();
      return mcpKeyStamp(
        { keyId: user.keyId, keyName: user.keyName },
        options.runId
      );
    },
  };
}

export function runGuard(
  user: AuthenticatedUser,
  scope: string
): GuardResult {
  if (!hasScope(user, scope)) {
    return {
      ok: false,
      userId: user.userId,
      error: {
        type: "scope",
        scope,
        message:
          `Missing required scope "${scope}". ` +
          `Key "${user.keyName}" has: ${user.scopes.join(", ") || "none"}.`,
      },
    };
  }

  const rl = consumeRateLimit(user);
  if (!rl.allowed) {
    return {
      ok: false,
      userId: user.userId,
      error: {
        type: "rate_limit",
        retryAfterMs: rl.retryAfterMs,
        message:
          `Rate limit exceeded (${rl.limit}/min). ` +
          `Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
      },
    };
  }

  return {
    ok: true,
    userId: user.userId,
    user,
    rateLimit: { remaining: rl.remaining, limit: rl.limit },
  };
}

/**
 * Build a standard MCP `CallToolResult` error payload from a GuardError.
 * Handlers can `return errorResult(guard)` when the guard fails.
 */
export function errorResult(guard: GuardError) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            error: guard.error.type,
            message: guard.error.message,
            ...(guard.error.scope ? { scope: guard.error.scope } : {}),
            ...(guard.error.retryAfterMs !== undefined
              ? { retry_after_ms: guard.error.retryAfterMs }
              : {}),
          },
          null,
          2
        ),
      },
    ],
    isError: true as const,
  };
}
