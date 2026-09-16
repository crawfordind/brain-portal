/**
 * Per-key rate limiting for MCP tool invocations.
 *
 * Uses an in-memory token bucket keyed by API-key ID. Each key has a
 * configurable `rate_limit_per_minute` (stored on the key record). The
 * bucket refills continuously at `perMinute / 60000` tokens per ms and
 * can burst up to one full minute of capacity.
 *
 * This is a per-process limiter. The MCP server runs as a single Node
 * process, so that's sufficient. For HTTP transport, Next.js serverless
 * runtimes may cold-start a new process per request, in which case this
 * limiter resets — acceptable since the HTTP endpoint also enforces auth
 * on every call.
 */

import type { AuthenticatedUser } from "./auth";

interface Bucket {
  tokens: number;
  lastRefill: number;
  capacity: number;
  refillPerMs: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  /** Tokens remaining after this call (0 if rejected). */
  remaining: number;
  /** Ms to wait before the next token is available (0 if allowed). */
  retryAfterMs: number;
  /** Per-minute ceiling. */
  limit: number;
}

/**
 * Attempt to consume one token from the user's bucket.
 * Rejects with `retryAfterMs` if the bucket is empty.
 *
 * The dev-mode fallback (`keyId === "dev-fallback"`) bypasses the limiter
 * entirely so local dev isn't throttled.
 */
export function consumeRateLimit(user: AuthenticatedUser): RateLimitResult {
  const perMinute = user.rateLimitPerMinute ?? 60;

  if (user.keyId === "dev-fallback") {
    return { allowed: true, remaining: perMinute, retryAfterMs: 0, limit: perMinute };
  }

  const now = Date.now();
  let bucket = buckets.get(user.keyId);
  if (!bucket || bucket.capacity !== perMinute) {
    // New bucket or limit changed — start full.
    bucket = {
      tokens: perMinute,
      lastRefill: now,
      capacity: perMinute,
      refillPerMs: perMinute / 60_000,
    };
    buckets.set(user.keyId, bucket);
  }

  // Refill based on elapsed time.
  const elapsed = now - bucket.lastRefill;
  if (elapsed > 0) {
    bucket.tokens = Math.min(
      bucket.capacity,
      bucket.tokens + elapsed * bucket.refillPerMs
    );
    bucket.lastRefill = now;
  }

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return {
      allowed: true,
      remaining: Math.floor(bucket.tokens),
      retryAfterMs: 0,
      limit: perMinute,
    };
  }

  const need = 1 - bucket.tokens;
  const retryAfterMs = Math.ceil(need / bucket.refillPerMs);
  return { allowed: false, remaining: 0, retryAfterMs, limit: perMinute };
}

/** Test helper: wipe all bucket state. */
export function resetRateLimits(): void {
  buckets.clear();
}

/** Test/diagnostic helper: introspect the bucket for a key. */
export function peekBucket(keyId: string): Bucket | undefined {
  return buckets.get(keyId);
}
