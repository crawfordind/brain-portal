/**
 * Link Scraper Service
 *
 * Full content scraping using Mozilla Readability and linkedom.
 * For lightweight metadata only, use link-metadata.ts instead.
 */

import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import { safeFetch, BlockedUrlError } from '@/lib/utils/safe-fetch';
import {
  extractFavicon,
  extractMetadataFromHtml,
} from '@/lib/services/link-metadata';

// Re-export from link-metadata for backwards compatibility
export type { MetadataResult } from '@/lib/services/link-metadata';
export { fetchMetadata } from '@/lib/services/link-metadata';
export { isValidUrl } from '@/lib/utils/url';

const FETCH_TIMEOUT = 10000; // 10 seconds

export interface ScrapeResult {
  title?: string;
  description?: string;
  favicon?: string;
  ogImage?: string;
  statusCode: number;
  error?: string;
  content: string;      // Cleaned article text
  wordCount: number;
  scrapedAt: string;
}

/**
 * Scrapes full content from URL using Mozilla Readability
 * Speed target: 5-10 seconds
 */
export async function scrapeFullContent(url: string): Promise<ScrapeResult> {
  try {
    // safeFetch validates the URL, re-checks every DNS answer, re-validates
    // each redirect hop and caps the body. Scraped text is written to a
    // database row the user can read back, so an unvalidated fetch here is a
    // read primitive against the host's private network.
    const response = await safeFetch(url, { timeoutMs: FETCH_TIMEOUT });
    const statusCode = response.status;

    if (statusCode < 200 || statusCode >= 300) {
      return {
        content: '',
        wordCount: 0,
        scrapedAt: new Date().toISOString(),
        statusCode,
        error: `HTTP ${statusCode}`,
      };
    }

    const html = response.body;

    // Extract metadata from the HTML we already have. This used to call
    // fetchMetadata(url), which downloaded the very same page a second time —
    // two full page loads per scrape, and two chances to be rate-limited.
    const { title, description, ogImage } = extractMetadataFromHtml(html, url);
    const favicon = extractFavicon(html, url);
    const metadata = { title, description, ogImage, favicon };

    // Use Mozilla Readability to extract article content
    const { document } = parseHTML(html);
    const reader = new Readability(document as unknown as Document);
    const article = reader.parse();

    if (!article) {
      return {
        content: '',
        wordCount: 0,
        scrapedAt: new Date().toISOString(),
        statusCode,
        title: metadata.title,
        description: metadata.description,
        favicon: metadata.favicon,
        ogImage: metadata.ogImage,
        error: 'Failed to extract article content using Readability',
      };
    }

    // Clean and extract text content (not HTML)
    const content = article.textContent || '';
    const wordCount = content.split(/\s+/).filter(word => word.length > 0).length;

    return {
      content,
      wordCount,
      scrapedAt: new Date().toISOString(),
      statusCode,
      title: metadata.title,
      description: metadata.description,
      favicon: metadata.favicon,
      ogImage: metadata.ogImage,
    };
  } catch (error) {
    if (error instanceof BlockedUrlError) {
      return {
        content: '',
        wordCount: 0,
        scrapedAt: new Date().toISOString(),
        statusCode: 0,
        error: 'URL is not a reachable public address',
      };
    }

    // Handle network errors, timeouts, parsing errors, etc.
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      content: '',
      wordCount: 0,
      scrapedAt: new Date().toISOString(),
      statusCode: 0,
      error: `Failed to scrape content: ${errorMessage}`,
    };
  }
}
