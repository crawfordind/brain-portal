/**
 * Link Metadata Service
 *
 * Lightweight metadata extraction without heavy dependencies.
 * Uses node-html-parser for fast HTML parsing.
 */

import { parse } from 'node-html-parser';
import { safeFetch, BlockedUrlError } from '@/lib/utils/safe-fetch';

const FETCH_TIMEOUT = 10000; // 10 seconds

export interface MetadataResult {
  title?: string;
  description?: string;
  favicon?: string;
  ogImage?: string;
  statusCode: number;
  error?: string;
}

/**
 * Extracts domain from URL for fallbacks
 */
function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return 'Unknown';
  }
}

/**
 * Fetches favicon with fallback strategies
 */
export function extractFavicon(html: string, url: string): string | undefined {
  const root = parse(html);
  const domain = extractDomain(url);

  // Strategy 1: <link rel="icon">
  const iconLink = root.querySelector('link[rel="icon"]') ||
                   root.querySelector('link[rel="shortcut icon"]');
  if (iconLink) {
    const href = iconLink.getAttribute('href');
    if (href) {
      // Make absolute URL if relative
      try {
        return new URL(href, url).toString();
      } catch {
        // If URL construction fails, try favicon.ico
      }
    }
  }

  // Strategy 2: /favicon.ico
  try {
    const faviconUrl = new URL('/favicon.ico', url).toString();
    return faviconUrl;
  } catch {
    // Fall through to Google Favicon Service
  }

  // Strategy 3: Google Favicon Service
  return `https://www.google.com/s2/favicons?domain=${domain}`;
}

/**
 * Converts a potentially relative URL to an absolute URL
 */
function toAbsoluteUrl(relativeUrl: string, baseUrl: string): string {
  try {
    return new URL(relativeUrl, baseUrl).toString();
  } catch {
    return relativeUrl;
  }
}

/**
 * Extracts metadata (title, description, ogImage) from HTML
 * Priority: Open Graph > Twitter Cards > Standard meta > Fallbacks
 */
/**
 * Pull title/description/ogImage out of HTML that has already been fetched.
 *
 * Exported so `scrapeFullContent` can reuse the body it already downloaded
 * instead of fetching the same page a second time.
 */
export function extractMetadataFromHtml(html: string, url: string) {
  const root = parse(html);

  // Extract title with priority order
  const title =
    root.querySelector('meta[property="og:title"]')?.getAttribute('content') ||
    root.querySelector('meta[name="twitter:title"]')?.getAttribute('content') ||
    root.querySelector('title')?.text ||
    'Untitled';

  // Extract description with priority order
  const description =
    root.querySelector('meta[property="og:description"]')?.getAttribute('content') ||
    root.querySelector('meta[name="twitter:description"]')?.getAttribute('content') ||
    root.querySelector('meta[name="description"]')?.getAttribute('content') ||
    extractDomain(url);

  // Extract ogImage with priority order
  const ogImageRaw =
    root.querySelector('meta[property="og:image"]')?.getAttribute('content') ||
    root.querySelector('meta[name="twitter:image"]')?.getAttribute('content');
  const ogImage = ogImageRaw ? toAbsoluteUrl(ogImageRaw, url) : undefined;

  return { title, description, ogImage };
}

/**
 * Fetches and extracts metadata from URL
 * Priority: OG tags > Twitter Cards > Standard meta > Fallbacks
 * Speed target: < 2 seconds
 */
export async function fetchMetadata(url: string): Promise<MetadataResult> {
  try {
    // safeFetch validates the URL, re-checks every DNS answer and re-validates
    // each redirect hop. It is the only fetch this module is allowed to make.
    const response = await safeFetch(url, { timeoutMs: FETCH_TIMEOUT });
    const statusCode = response.status;

    if (statusCode < 200 || statusCode >= 300) {
      return {
        statusCode,
        error: `HTTP ${statusCode}`,
      };
    }

    const html = response.body;

    // Extract metadata
    const { title, description, ogImage } = extractMetadataFromHtml(html, url);
    const favicon = extractFavicon(html, url);

    return {
      title,
      description,
      favicon,
      ogImage,
      statusCode,
    };
  } catch (error) {
    // A blocked URL is a refusal, not a transport failure — say so plainly so
    // the caller does not retry it forever.
    if (error instanceof BlockedUrlError) {
      return { statusCode: 0, error: 'URL is not a reachable public address' };
    }

    // Network/fetch errors
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Timeout or network error
    if (errorMessage.includes('aborted') || errorMessage.includes('timeout')) {
      return {
        statusCode: 0,
        error: 'Request timeout',
      };
    }

    return {
      statusCode: 0,
      error: `Failed to fetch metadata: ${errorMessage}`,
    };
  }
}
