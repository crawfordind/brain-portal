/**
 * URL validation utilities
 * Safe for use in both client and server components.
 *
 * Nothing here performs DNS resolution — it is pure string work so it can run
 * in the browser bundle. A hostname that merely *looks* public can still
 * resolve to a private address, so server-side fetches must additionally go
 * through `safeFetch` (src/lib/utils/safe-fetch.ts), which re-checks every
 * resolved IP and every redirect hop.
 */

/**
 * Validates if a string is a valid HTTP/HTTPS URL
 */
export function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  '0.0.0.0',
  '[::]',
  '[::1]',
  // Cloud instance-metadata aliases. The literal IPs are covered by the
  // link-local range below, but these names resolve to them directly.
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
]);

/**
 * True when `ip` is a dotted-quad IPv4 literal in a range that must never be
 * reachable from a user-supplied URL.
 */
function isPrivateIPv4(ip: string): boolean {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;

  const octets = m.slice(1).map(Number);
  if (octets.some((o) => o > 255)) return true; // not a valid address at all
  const [a, b] = octets;

  if (a === 0) return true;                          // 0.0.0.0/8   "this network"
  if (a === 10) return true;                         // 10.0.0.0/8  private
  if (a === 127) return true;                        // 127.0.0.0/8 loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 169 && b === 254) return true;           // 169.254.0.0/16 link-local (cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true;  // 172.16.0.0/12 private
  if (a === 192 && b === 0) return true;             // 192.0.0.0/24 + 192.0.2.0/24 IETF reserved
  if (a === 192 && b === 168) return true;           // 192.168.0.0/16 private
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
  if (a === 198 && b === 51) return true;            // 198.51.100.0/24 TEST-NET-2
  if (a === 203 && b === 0) return true;             // 203.0.113.0/24 TEST-NET-3
  if (a >= 224) return true;                         // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved

  return false;
}

/**
 * True when `host` must never be fetched. Accepts a bare hostname, a dotted
 * quad, or an IPv6 literal with or without brackets.
 *
 * Exported so `safeFetch` can re-apply it to each address DNS actually returns
 * — the check below is the only thing standing between a user-supplied link
 * and the cloud metadata service.
 */
export function isPrivateHost(host: string): boolean {
  const hostname = host.trim().toLowerCase();
  if (!hostname) return true;
  if (BLOCKED_HOSTNAMES.has(hostname)) return true;

  // Anything under .localhost, .local or .internal is by definition not public.
  if (/\.(localhost|local|internal|home\.arpa)$/.test(hostname)) return true;

  const ip = hostname.replace(/^\[|\]$/g, '');

  if (isPrivateIPv4(ip)) return true;

  // A bare integer or hex literal is a legal IPv4 form to most resolvers
  // (http://2130706433/ is 127.0.0.1) and would otherwise sail past the
  // dotted-quad test above.
  if (/^\d+$/.test(ip) || /^0x[0-9a-f]+$/.test(ip)) return true;

  if (ip.includes(':')) {
    if (ip === '::1' || ip === '::') return true;
    if (ip.startsWith('fe80:')) return true;           // link-local
    if (/^f[cd]/.test(ip)) return true;                // fc00::/7 unique-local
    if (ip.startsWith('ff')) return true;              // ff00::/8 multicast
    // IPv4-mapped (::ffff:127.0.0.1) and IPv4-compatible (::127.0.0.1) forms
    // smuggle a v4 address through a v6 literal.
    const mapped = ip.match(/:((?:\d{1,3}\.){3}\d{1,3})$/);
    if (mapped && isPrivateIPv4(mapped[1])) return true;
    if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(ip)) return true;
  }

  return false;
}

/**
 * Validates that a URL is a valid HTTP/HTTPS URL pointing to a public host.
 * Blocks localhost, private IPs, link-local, and reserved ranges to prevent SSRF.
 *
 * This is a *necessary* check, not a sufficient one — see the module note.
 */
export function isPublicUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    // Credentials in the URL are a redirect-laundering trick and are never
    // needed for scraping a public page.
    if (parsed.username || parsed.password) return false;
    if (isPrivateHost(parsed.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Extracts the first URL from a text string
 */
export function extractUrl(text: string): string | null {
  const urlRegex = /https?:\/\/[^\s]+/gi;
  const match = text.match(urlRegex);
  return match ? match[0] : null;
}
