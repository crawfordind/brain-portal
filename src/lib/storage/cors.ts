/**
 * The CORS rule a bucket needs for browsers to upload to it directly.
 *
 * Large files are PUT straight to R2 from the browser with a presigned URL
 * (see /api/attachments/uploads). A cross-origin PUT is preflighted, and
 * without a rule allowing the app's origin the browser refuses it before a
 * byte is sent, reporting only "network error". Pure, so it can be tested.
 */

export interface BucketCorsRule {
  AllowedOrigins: string[];
  AllowedMethods: string[];
  AllowedHeaders: string[];
  ExposeHeaders: string[];
  MaxAgeSeconds: number;
}

/** Reduce each entry to a bare origin (`https://app.example.com`), dropping paths and duplicates. */
export function normalizeOrigins(values: string[]): string[] {
  const origins = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    try {
      const url = new URL(trimmed);
      if (url.protocol === 'https:' || url.protocol === 'http:') origins.add(url.origin);
    } catch {
      // Not a URL; skipped rather than written into the bucket's policy
    }
  }
  return [...origins];
}

export function buildUploadCorsRule(origins: string[]): BucketCorsRule {
  const allowed = normalizeOrigins(origins);
  if (allowed.length === 0) {
    throw new Error('No valid origin given. Pass the address the app is served from, e.g. https://<your-domain>.');
  }
  return {
    AllowedOrigins: allowed,
    // GET/HEAD so previews and downloads keep working from the app's origin
    AllowedMethods: ['PUT', 'GET', 'HEAD'],
    AllowedHeaders: ['content-type'],
    ExposeHeaders: ['etag'],
    MaxAgeSeconds: 3600,
  };
}
