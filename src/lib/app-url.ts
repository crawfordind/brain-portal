/**
 * The one place that decides what origin a link sent *outside the browser*
 * points at: emails, magic links, invites, share links.
 *
 * Every caller used to write `process.env.NEXT_PUBLIC_APP_URL ||
 * "http://localhost:3000"`, so a deployment where that variable was missing
 * mailed out links to localhost. Two things made that easy to hit:
 *
 * 1. `NEXT_PUBLIC_*` variables are inlined at *build* time. Adding one in the
 *    host's dashboard after a deploy does nothing until the next build, and a
 *    cron-sent email has no request to fall back on.
 * 2. A value copied from `.env.local` ("http://localhost:3000") into
 *    production is indistinguishable from a real one to that expression.
 *
 * Resolution order:
 *   APP_URL (server-only, read at runtime) → NEXT_PUBLIC_APP_URL →
 *   VERCEL_PROJECT_PRODUCTION_URL (production deploys only) →
 *   the request origin, when the caller has one → VERCEL_URL →
 *   http://localhost:3000 (development only).
 *
 * A loopback candidate is skipped in production, so a stale dev value can
 * never be the answer while a real one is available. Imports nothing, so it is
 * safe from the MCP server, API routes and tests alike.
 */

const LOCAL_FALLBACK = "http://localhost:3000";

type Env = Record<string, string | undefined>;

export interface AppUrlOptions {
  /** Origin of the request being served, if there is one. */
  requestOrigin?: string | null;
  /** Injected for tests; defaults to `process.env`. */
  env?: Env;
}

/** Normalise a configured value into `scheme://host[:port][/path]` with no trailing slash. */
export function normalizeOrigin(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let value = raw.trim();
  if (!value) return null;
  // Vercel's system variables are bare hostnames ("app.example.com").
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    value = `${isLoopbackHost(value.split(/[/:]/)[0]) ? "http" : "https"}://${value}`;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const path = url.pathname.replace(/\/+$/, "");
    return `${url.protocol}//${url.host}${path}`;
  } catch {
    return null;
  }
}

function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h === "0.0.0.0" ||
    h === "::1" ||
    /^127\./.test(h)
  );
}

export function isLoopbackOrigin(origin: string): boolean {
  try {
    return isLoopbackHost(new URL(origin).hostname);
  } catch {
    return false;
  }
}

function isProduction(env: Env): boolean {
  return env.NODE_ENV === "production" || env.VERCEL_ENV === "production";
}

/**
 * The public origin of this deployment, with no trailing slash.
 */
export function getAppUrl(options: AppUrlOptions = {}): string {
  const env = options.env ?? process.env;
  const production = isProduction(env);

  const candidates: (string | null)[] = [
    normalizeOrigin(env.APP_URL),
    normalizeOrigin(env.NEXT_PUBLIC_APP_URL),
    // Only a production deploy should mint links to the production domain;
    // a preview should link to itself.
    env.VERCEL_ENV === "production"
      ? normalizeOrigin(env.VERCEL_PROJECT_PRODUCTION_URL)
      : null,
    normalizeOrigin(options.requestOrigin),
    normalizeOrigin(env.VERCEL_URL),
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    if (production && isLoopbackOrigin(candidate)) continue;
    return candidate;
  }

  return LOCAL_FALLBACK;
}

/**
 * Whether `getAppUrl()` found a real address. False means links would point at
 * localhost — worth surfacing rather than mailing out.
 */
export function hasPublicAppUrl(options: AppUrlOptions = {}): boolean {
  return !isLoopbackOrigin(getAppUrl(options));
}

/** `path` resolved against the app origin. Absolute URLs pass through. */
export function absoluteUrl(path: string = "/", options: AppUrlOptions = {}): string {
  if (/^https?:\/\//i.test(path)) return path;
  const base = getAppUrl(options);
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}
