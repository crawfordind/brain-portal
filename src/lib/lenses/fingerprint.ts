/**
 * A cheap, deterministic fingerprint of a note body (FNV-1a, 32-bit, plus the
 * length). Server and browser compute the same value, which is how the lens
 * strip knows a cached "read deeper" result was taken from an older draft.
 * Not a security boundary; `crypto` is deliberately avoided so this runs in
 * the browser bundle.
 */
export function contentFingerprint(content: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < content.length; i++) {
    h ^= content.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${(h >>> 0).toString(16).padStart(8, "0")}-${content.length.toString(36)}`;
}
