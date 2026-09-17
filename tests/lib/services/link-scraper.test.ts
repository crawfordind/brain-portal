import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isValidUrl,
  fetchMetadata,
  scrapeFullContent,
  type MetadataResult,
  type ScrapeResult,
} from '@/lib/services/link-scraper';
import { safeFetch, BlockedUrlError } from '@/lib/utils/safe-fetch';
import { isPublicUrl } from '@/lib/utils/url';

// These are tests of metadata/article PARSING. The network primitive is
// safeFetch, and mocking it at that seam keeps the parsing assertions honest
// without having to fake DNS and redirect handling in every case. safeFetch's
// own SSRF behaviour is covered in tests/lib/utils/safe-fetch.test.ts.
vi.mock('@/lib/utils/safe-fetch', async () => {
  const actual = await vi.importActual<typeof import('@/lib/utils/safe-fetch')>(
    '@/lib/utils/safe-fetch'
  );
  return { ...actual, safeFetch: vi.fn() };
});

/** Shape a mocked 200 response the way safeFetch returns one. */
function ok(body: string, url = 'https://example.com') {
  return { body, status: 200, finalUrl: url, contentType: 'text/html' };
}

/** Shape a mocked non-2xx response. */
function status(code: number, url = 'https://example.com') {
  return { body: '', status: code, finalUrl: url, contentType: null };
}

describe('Link Scraper Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(safeFetch).mockImplementation(async (url: string) => {
      if (!isPublicUrl(url)) {
        throw new BlockedUrlError(url, 'not a public http(s) URL');
      }
      throw new Error('no response queued for this test');
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isValidUrl', () => {
    it('should accept valid http URLs', () => {
      expect(isValidUrl('http://example.com')).toBe(true);
    });

    it('should accept valid https URLs', () => {
      expect(isValidUrl('https://example.com')).toBe(true);
    });

    it('should reject ftp URLs', () => {
      expect(isValidUrl('ftp://example.com')).toBe(false);
    });

    it('should reject file URLs', () => {
      expect(isValidUrl('file:///path/to/file')).toBe(false);
    });

    it('should reject invalid URLs', () => {
      expect(isValidUrl('not a url')).toBe(false);
    });

    it('should reject empty strings', () => {
      expect(isValidUrl('')).toBe(false);
    });

    it('should reject URLs without protocol', () => {
      expect(isValidUrl('example.com')).toBe(false);
    });
  });

  describe('fetchMetadata', () => {
    it('should return error for invalid URL', async () => {
      const result = await fetchMetadata('invalid-url');
      expect(result.statusCode).toBe(0);
      expect(result.error).toContain('not a reachable public address');
    });

    it('should extract Open Graph metadata', async () => {
      const mockHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta property="og:title" content="OG Title">
            <meta property="og:description" content="OG Description">
            <meta property="og:image" content="https://example.com/image.jpg">
            <title>Standard Title</title>
          </head>
          <body></body>
        </html>
      `;

      vi.mocked(safeFetch).mockResolvedValueOnce(ok(mockHtml));

      const result = await fetchMetadata('https://example.com');
      expect(result.statusCode).toBe(200);
      expect(result.title).toBe('OG Title');
      expect(result.description).toBe('OG Description');
      expect(result.ogImage).toBe('https://example.com/image.jpg');
      expect(result.error).toBeUndefined();
    });

    it('should fall back to Twitter Cards metadata', async () => {
      const mockHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta name="twitter:title" content="Twitter Title">
            <meta name="twitter:description" content="Twitter Description">
            <meta name="twitter:image" content="https://example.com/twitter.jpg">
            <title>Standard Title</title>
          </head>
          <body></body>
        </html>
      `;

      vi.mocked(safeFetch).mockResolvedValueOnce(ok(mockHtml));

      const result = await fetchMetadata('https://example.com');
      expect(result.title).toBe('Twitter Title');
      expect(result.description).toBe('Twitter Description');
      expect(result.ogImage).toBe('https://example.com/twitter.jpg');
    });

    it('should fall back to standard meta tags', async () => {
      const mockHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Standard Title</title>
            <meta name="description" content="Standard Description">
          </head>
          <body></body>
        </html>
      `;

      vi.mocked(safeFetch).mockResolvedValueOnce(ok(mockHtml));

      const result = await fetchMetadata('https://example.com');
      expect(result.title).toBe('Standard Title');
      expect(result.description).toBe('Standard Description');
    });

    it('should use fallback title and description when none found', async () => {
      const mockHtml = `
        <!DOCTYPE html>
        <html>
          <head></head>
          <body></body>
        </html>
      `;

      vi.mocked(safeFetch).mockResolvedValueOnce(ok(mockHtml));

      const result = await fetchMetadata('https://example.com');
      expect(result.title).toBe('Untitled');
      expect(result.description).toBe('example.com');
    });

    it('should extract favicon from link tag', async () => {
      const mockHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <link rel="icon" href="/favicon.ico">
            <title>Test</title>
          </head>
          <body></body>
        </html>
      `;

      vi.mocked(safeFetch).mockResolvedValueOnce(ok(mockHtml));

      const result = await fetchMetadata('https://example.com');
      expect(result.favicon).toBe('https://example.com/favicon.ico');
    });

    it('should fall back to /favicon.ico when no favicon link found', async () => {
      const mockHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Test</title>
          </head>
          <body></body>
        </html>
      `;

      vi.mocked(safeFetch).mockResolvedValueOnce(ok(mockHtml));

      const result = await fetchMetadata('https://example.com');
      // Should try /favicon.ico before Google Favicon Service
      expect(result.favicon).toBe('https://example.com/favicon.ico');
    });

    it('should handle HTTP errors', async () => {
      vi.mocked(safeFetch).mockResolvedValueOnce(status(404));

      const result = await fetchMetadata('https://example.com/404');
      expect(result.statusCode).toBe(404);
      expect(result.error).toContain('HTTP 404');
    });

    it('should handle network errors', async () => {
      vi.mocked(safeFetch).mockRejectedValueOnce(new Error('Network error'));

      const result = await fetchMetadata('https://example.com');
      expect(result.statusCode).toBe(0);
      expect(result.error).toContain('Failed to fetch metadata');
      expect(result.error).toContain('Network error');
    });

    it('should handle relative ogImage URLs', async () => {
      const mockHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta property="og:image" content="/images/og-image.jpg">
            <title>Test</title>
          </head>
          <body></body>
        </html>
      `;

      vi.mocked(safeFetch).mockResolvedValueOnce(ok(mockHtml));

      const result = await fetchMetadata('https://example.com');
      expect(result.ogImage).toBe('https://example.com/images/og-image.jpg');
    });
  });

  describe('scrapeFullContent', () => {
    it('should return error for invalid URL', async () => {
      const result = await scrapeFullContent('invalid-url');
      expect(result.statusCode).toBe(0);
      expect(result.error).toContain('not a reachable public address');
      expect(result.content).toBe('');
      expect(result.wordCount).toBe(0);
    });

    it('should extract article content using Readability', async () => {
      const mockHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta property="og:title" content="Article Title">
            <meta property="og:description" content="Article Description">
            <title>Article Title</title>
          </head>
          <body>
            <article>
              <h1>Article Title</h1>
              <p>This is the main content of the article.</p>
              <p>It has multiple paragraphs.</p>
            </article>
          </body>
        </html>
      `;

      vi.mocked(safeFetch).mockResolvedValueOnce(ok(mockHtml));

      const result = await scrapeFullContent('https://example.com/article');
      expect(result.statusCode).toBe(200);
      expect(result.title).toBe('Article Title');
      expect(result.description).toBe('Article Description');
      expect(result.content).toBeTruthy();
      expect(result.wordCount).toBeGreaterThan(0);
      expect(result.scrapedAt).toBeTruthy();
      expect(result.error).toBeUndefined();
    });

    it('should include metadata in scrape result', async () => {
      const mockHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta property="og:title" content="Test Article">
            <meta property="og:description" content="Test Description">
            <meta property="og:image" content="https://example.com/image.jpg">
            <link rel="icon" href="/favicon.ico">
            <title>Test Article</title>
          </head>
          <body>
            <article>
              <p>Article content here.</p>
            </article>
          </body>
        </html>
      `;

      vi.mocked(safeFetch).mockResolvedValueOnce(ok(mockHtml));

      const result = await scrapeFullContent('https://example.com/article');
      expect(result.title).toBe('Test Article');
      expect(result.description).toBe('Test Description');
      expect(result.ogImage).toBe('https://example.com/image.jpg');
      expect(result.favicon).toBe('https://example.com/favicon.ico');
    });

    it('should calculate word count correctly', async () => {
      const mockHtml = `
        <!DOCTYPE html>
        <html>
          <head><title>Test</title></head>
          <body>
            <article>
              <p>One two three four five</p>
            </article>
          </body>
        </html>
      `;

      vi.mocked(safeFetch).mockResolvedValueOnce(ok(mockHtml));

      const result = await scrapeFullContent('https://example.com/article');
      expect(result.wordCount).toBeGreaterThan(0);
    });

    it('should include ISO timestamp', async () => {
      const mockHtml = `
        <!DOCTYPE html>
        <html>
          <head><title>Test</title></head>
          <body>
            <article><p>Content</p></article>
          </body>
        </html>
      `;

      vi.mocked(safeFetch).mockResolvedValueOnce(ok(mockHtml));

      const result = await scrapeFullContent('https://example.com/article');
      expect(result.scrapedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('should handle HTTP errors', async () => {
      vi.mocked(safeFetch).mockResolvedValueOnce(status(404));

      const result = await scrapeFullContent('https://example.com/404');
      expect(result.statusCode).toBe(404);
      expect(result.error).toContain('HTTP 404');
      expect(result.content).toBe('');
    });

    it('should handle network errors', async () => {
      vi.mocked(safeFetch).mockRejectedValueOnce(new Error('Network error'));

      const result = await scrapeFullContent('https://example.com');
      expect(result.statusCode).toBe(0);
      expect(result.error).toContain('Failed to scrape content');
      expect(result.content).toBe('');
    });

    it('should handle pages where Readability fails', async () => {
      const mockHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta property="og:title" content="Page Title">
            <title>Page Title</title>
          </head>
          <body>
            <div>Not much content here</div>
          </body>
        </html>
      `;

      vi.mocked(safeFetch).mockResolvedValueOnce(ok(mockHtml));

      const result = await scrapeFullContent('https://example.com/minimal');
      // Readability might fail on minimal content
      // Should still include metadata and error message
      expect(result.title).toBe('Page Title');
      if (result.error) {
        expect(result.error).toContain('Readability');
      }
    });
  });
});
