/**
 * SSRF-resistant fetch for URLs that came from a user.
 *
 * `isPublicUrl` alone is not enough, and both of its gaps were reachable:
 *
 *  1. It inspects the hostname as a *string*. `evil.example.com` can have an A
 *     record pointing at 169.254.169.254, so the string check passes and the
 *     request still lands on the cloud metadata service. We resolve the name
 *     ourselves and re-check every address that comes back.
 *
 *  2. `fetch` follows redirects by default and validates nothing on the way.
 *     A public URL that 302s to http://169.254.169.254/ walked straight
 *     through. We follow redirects manually and re-validate each hop.
 *
 * It also caps the response body, because the callers (link scraping) put the
 * result into a database row.
 */

import { resolveHostAddresses } from './dns';
import { isPrivateHost, isPublicUrl } from './url';

/** Redirect hops to follow before giving up. */
const MAX_REDIRECTS = 5;

/** Hard cap on a downloaded body. Scraped pages are text; 5 MB is generous. */
const MAX_BODY_BYTES = 5 * 1024 * 1024;

export class BlockedUrlError extends Error {
  constructor(url: string, reason: string) {
    super(`Refusing to fetch ${url}: ${reason}`);
    this.name = 'BlockedUrlError';
  }
}

/**
 * Resolve `hostname` and throw if any returned address is private.
 *
 * Checking *all* addresses rather than the first is deliberate: a name with
 * both a public and a private A record would otherwise be a coin flip, and the
 * attacker gets to retry until it lands.
 *
 * This leaves a narrow DNS-rebinding window — the name is resolved here and
 * again by fetch — which cannot be closed without pinning the socket to an
 * address. The window is documented rather than papered over; for a
 * self-hosted deployment handling untrusted links, put an egress proxy in
 * front of this.
 */
async function assertHostResolvesPublic(hostname: string): Promise<void> {
  // An IP literal needs no resolution; isPrivateHost already judged it.
  if (isPrivateHost(hostname)) {
    throw new BlockedUrlError(hostname, 'host is private, loopback or reserved');
  }

  const addresses = await resolveHostAddresses(hostname);

  // A name that does not resolve is refused rather than allowed through: an
  // unresolvable host cannot be checked, and "cannot check" must not mean "is
  // fine".
  if (addresses.length === 0) {
    throw new BlockedUrlError(hostname, 'host could not be resolved');
  }

  for (const address of addresses) {
    if (isPrivateHost(address)) {
      throw new BlockedUrlError(
        hostname,
        `host resolves to a private address (${address})`
      );
    }
  }
}

export interface SafeFetchOptions {
  timeoutMs?: number;
  headers?: Record<string, string>;
  maxBodyBytes?: number;
}

export interface SafeFetchResult {
  /** Decoded response body, truncated at the byte cap. */
  body: string;
  status: number;
  /** The URL the final response actually came from, after redirects. */
  finalUrl: string;
  contentType: string | null;
}

/**
 * Fetch a user-supplied URL, validating the target before every hop.
 *
 * Throws `BlockedUrlError` when the URL — or anywhere it redirects to — is not
 * a public HTTP(S) endpoint. Other failures (timeout, DNS, transport) throw
 * their usual errors.
 */
export async function safeFetch(
  url: string,
  options: SafeFetchOptions = {}
): Promise<SafeFetchResult> {
  const { timeoutMs = 10_000, headers = {}, maxBodyBytes = MAX_BODY_BYTES } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let current = url;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!isPublicUrl(current)) {
        throw new BlockedUrlError(current, 'not a public http(s) URL');
      }
      await assertHostResolvesPublic(new URL(current).hostname);

      const response = await fetch(current, {
        signal: controller.signal,
        redirect: 'manual',
        headers,
      });

      // 3xx with a Location is a hop we re-validate rather than follow blindly.
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) {
          return {
            body: '',
            status: response.status,
            finalUrl: current,
            contentType: response.headers.get('content-type'),
          };
        }
        // Relative Locations are legal; resolve against the current URL.
        current = new URL(location, current).toString();
        continue;
      }

      return {
        body: await readCapped(response, maxBodyBytes),
        status: response.status,
        finalUrl: current,
        contentType: response.headers.get('content-type'),
      };
    }

    throw new BlockedUrlError(url, `more than ${MAX_REDIRECTS} redirects`);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Read a response body, stopping at `limit` bytes.
 *
 * `response.text()` would buffer whatever the server chose to send, which lets
 * any URL the user pastes decide how much memory this process uses.
 */
async function readCapped(response: Response, limit: number): Promise<string> {
  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (total < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  const joined = new Uint8Array(Math.min(total, limit));
  let offset = 0;
  for (const chunk of chunks) {
    if (offset >= joined.length) break;
    const slice = chunk.subarray(0, joined.length - offset);
    joined.set(slice, offset);
    offset += slice.byteLength;
  }

  return new TextDecoder('utf-8', { fatal: false }).decode(joined);
}
