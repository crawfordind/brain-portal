import { headers } from "next/headers";

/**
 * Per-process, in-memory rate limiting.
 *
 * Two limits are worth knowing before you rely on this for anything:
 *
 *  1. The store is a `Map` in one process. On a serverless platform each
 *     instance keeps its own counters, so the effective limit is roughly
 *     `maxRequests × instances`. For a personal deployment that is fine. For
 *     anything exposed to real traffic, put a shared store (Redis, Upstash) or
 *     an edge rate limiter in front.
 *
 *  2. The client IP comes from `x-forwarded-for`, which is a plain request
 *     header. Behind a proxy that overwrites it (Vercel, Cloudflare, an
 *     nginx with `proxy_set_header`) it is trustworthy. Exposed directly to
 *     the internet it is attacker-controlled and every limit here is
 *     bypassable by varying the header. Set TRUST_PROXY_HEADERS=false when the
 *     app is directly reachable — the limiter then falls back to a single
 *     shared bucket, which is blunt but not forgeable.
 */

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

const rateLimitStore = new Map<
  string,
  { count: number; resetAt: number }
>();

// Maximum entries to prevent unbounded memory growth
const MAX_ENTRIES = 10000;

// Clean up expired entries (called probabilistically to avoid setInterval memory leak)
function cleanupExpiredEntries() {
  const now = Date.now();
  for (const [key, value] of rateLimitStore.entries()) {
    if (now > value.resetAt) {
      rateLimitStore.delete(key);
    }
  }
}

export async function checkRateLimit(
  config: RateLimitConfig = {
    maxRequests: 100,
    windowMs: 60 * 60 * 1000, // 1 hour
  }
): Promise<{ allowed: boolean; limit: number; remaining: number; resetAt: number }> {
  // Probabilistically clean up expired entries (10% chance per request)
  if (Math.random() < 0.1) {
    cleanupExpiredEntries();
  }

  const headersList = await headers();
  const key = `rate-limit:${await getClientKey(headersList)}`;
  const now = Date.now();

  let record = rateLimitStore.get(key);

  // Create new record if none exists or window expired
  if (!record || now > record.resetAt) {
    // Check if we're at max capacity before adding new entries
    if (!record && rateLimitStore.size >= MAX_ENTRIES) {
      console.warn(
        `[rate-limit] Rate limit store at max capacity (${MAX_ENTRIES} entries), forcing cleanup`
      );
      cleanupExpiredEntries();
    }

    record = {
      count: 0,
      resetAt: now + config.windowMs,
    };
  }

  record.count += 1;
  rateLimitStore.set(key, record);

  const allowed = record.count <= config.maxRequests;
  const remaining = Math.max(0, config.maxRequests - record.count);

  // Log when rate limit is exceeded. The key is not logged: it is a client IP,
  // which is personal data, and knowing the count is what's actionable.
  if (!allowed) {
    console.warn(
      `[rate-limit] Rate limit exceeded: ${record.count}/${config.maxRequests} requests`
    );
  }

  return {
    allowed,
    limit: config.maxRequests,
    remaining,
    resetAt: record.resetAt,
  };
}

/**
 * Whether `x-forwarded-for` may be believed.
 *
 * Defaults to true because the common deployments (Vercel, Fly, a reverse
 * proxy) all overwrite the header. Set TRUST_PROXY_HEADERS=false when Node is
 * directly internet-facing.
 */
function trustProxyHeaders(): boolean {
  return process.env.TRUST_PROXY_HEADERS?.trim().toLowerCase() !== "false";
}

async function getClientKey(
  headersList: Awaited<ReturnType<typeof headers>>
): Promise<string> {
  if (!trustProxyHeaders()) {
    // One shared bucket. Coarse, but it cannot be escaped by forging a header,
    // which is the failure mode that matters when there is no proxy.
    return "shared";
  }

  const forwarded = headersList.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || headersList.get("x-real-ip")?.trim();

  if (!ip) {
    console.warn(
      "[rate-limit] No client IP header present; falling back to a shared bucket"
    );
    return "shared";
  }

  return ip;
}
