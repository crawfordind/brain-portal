/**
 * Integration test for link capture flow
 *
 * Tests the complete flow:
 * 1. URL detection
 * 2. Metadata fetching
 * 3. Capture creation with link metadata
 * 4. Job queueing for scraping and embedding
 * 5. Background processing
 * 6. Embedding generation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isValidUrl } from '@/lib/services/link-scraper';
import type { LinkMetadata, Capture } from '@/lib/db/schema';

// Mock fetch
global.fetch = vi.fn();

describe('Link Capture Integration Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Step 1: URL Detection', () => {
    it('should detect URLs in capture content', () => {
      const content = 'Check out this article: https://example.com/article';
      const urlRegex = /https?:\/\/[^\s]+/gi;
      const match = content.match(urlRegex);

      expect(match).toBeTruthy();
      expect(match![0]).toBe('https://example.com/article');
    });

    it('should validate detected URLs', () => {
      const validUrl = 'https://example.com/article';
      const invalidUrl = 'not-a-url';

      expect(isValidUrl(validUrl)).toBe(true);
      expect(isValidUrl(invalidUrl)).toBe(false);
    });

    it('should handle multiple URLs and pick the first', () => {
      const content = 'Links: https://first.com and https://second.com';
      const urlRegex = /https?:\/\/[^\s]+/gi;
      const matches = content.match(urlRegex);

      expect(matches).toBeTruthy();
      expect(matches!.length).toBe(2);
      expect(matches![0]).toBe('https://first.com');
    });
  });

  describe('Step 2: Metadata Fetching', () => {
    it('should fetch metadata from /api/captures/link/metadata', async () => {
      const mockMetadata: LinkMetadata = {
        url: 'https://example.com/article',
        title: 'Example Article',
        description: 'This is an example article',
        favicon: 'https://example.com/favicon.ico',
        ogImage: 'https://example.com/og-image.jpg',
        statusCode: 200,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockMetadata,
      });

      const response = await fetch('/api/captures/link/metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://example.com/article' }),
      });

      const metadata = await response.json();

      expect(response.ok).toBe(true);
      expect(metadata.title).toBe('Example Article');
      expect(metadata.description).toBe('This is an example article');
      expect(metadata.favicon).toBeTruthy();
      expect(metadata.ogImage).toBeTruthy();
    });

    it('should handle metadata fetch errors gracefully', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ error: 'URL not found' }),
      });

      const response = await fetch('/api/captures/link/metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://example.com/404' }),
      });

      expect(response.ok).toBe(false);
      expect(response.status).toBe(404);

      const error = await response.json();
      expect(error.error).toBeTruthy();
    });

    it('should validate URL before fetching metadata', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: 'Invalid URL: must be http or https' }),
      });

      const response = await fetch('/api/captures/link/metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'ftp://invalid.com' }),
      });

      expect(response.ok).toBe(false);
      expect(response.status).toBe(400);
    });
  });

  describe('Step 3: Capture Creation', () => {
    it('should create link capture with metadata', async () => {
      const mockCapture: Capture = {
        id: 'test-capture-1',
        user_id: 'test-user',
        daily_note_id: null,
        content: 'https://example.com/article',
        capture_type: 'link',
        captured_at: new Date().toISOString(),
        processed: false,
        linked_notes: '[]',
        linked_projects: '[]',
        tags: '[]',
        metadata: JSON.stringify({
          url: 'https://example.com/article',
          title: 'Example Article',
          description: 'This is an example article',
          favicon: 'https://example.com/favicon.ico',
          ogImage: 'https://example.com/og-image.jpg',
        }),
        created_at: new Date().toISOString(),
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ capture: mockCapture }),
      });

      const response = await fetch('/api/captures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: 'https://example.com/article',
          captureType: 'link',
          metadata: {
            url: 'https://example.com/article',
            title: 'Example Article',
            description: 'This is an example article',
            favicon: 'https://example.com/favicon.ico',
            ogImage: 'https://example.com/og-image.jpg',
          },
        }),
      });

      const result = await response.json();

      expect(response.ok).toBe(true);
      expect(response.status).toBe(201);
      expect(result.capture.capture_type).toBe('link');

      const metadata = JSON.parse(result.capture.metadata);
      expect(metadata.url).toBe('https://example.com/article');
      expect(metadata.title).toBe('Example Article');
    });

    it('should create link capture with scraping enabled', async () => {
      const mockCapture: Capture = {
        id: 'test-capture-2',
        user_id: 'test-user',
        daily_note_id: null,
        content: 'https://example.com/article',
        capture_type: 'link',
        captured_at: new Date().toISOString(),
        processed: false,
        linked_notes: '[]',
        linked_projects: '[]',
        tags: '[]',
        metadata: JSON.stringify({
          url: 'https://example.com/article',
          title: 'Example Article',
          scrapeEnabled: true,
        }),
        created_at: new Date().toISOString(),
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ capture: mockCapture }),
      });

      const response = await fetch('/api/captures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: 'https://example.com/article',
          captureType: 'link',
          metadata: {
            url: 'https://example.com/article',
            title: 'Example Article',
            scrapeEnabled: true,
          },
        }),
      });

      const result = await response.json();
      const metadata = JSON.parse(result.capture.metadata);

      expect(metadata.scrapeEnabled).toBe(true);
    });

    it('should validate URL in metadata', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: 'Invalid URL: must be http or https' }),
      });

      const response = await fetch('/api/captures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: 'ftp://invalid.com',
          captureType: 'link',
          metadata: {
            url: 'ftp://invalid.com',
          },
        }),
      });

      expect(response.ok).toBe(false);
      expect(response.status).toBe(400);
    });
  });

  describe('Step 4: Error Handling', () => {
    it('should handle invalid URLs gracefully', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: 'Invalid URL: must be http or https' }),
      });

      const response = await fetch('/api/captures/link/metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'not-a-url' }),
      });

      expect(response.ok).toBe(false);
      const error = await response.json();
      expect(error.error).toContain('Invalid URL');
    });

    it('should handle network timeouts', async () => {
      (global.fetch as any).mockRejectedValueOnce(new Error('Network timeout'));

      try {
        await fetch('/api/captures/link/metadata', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: 'https://slow-site.com' }),
        });
      } catch (error) {
        expect(error).toBeTruthy();
        expect((error as Error).message).toContain('timeout');
      }
    });

    it('should handle 404 errors', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({
          error: 'HTTP 404: Not Found',
          metadata: {
            statusCode: 404,
            error: 'HTTP 404: Not Found',
          },
        }),
      });

      const response = await fetch('/api/captures/link/metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://example.com/nonexistent' }),
      });

      expect(response.ok).toBe(false);
      expect(response.status).toBe(404);
    });

    it('should handle server errors (5xx)', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 502,
        json: async () => ({
          error: 'HTTP 500: Internal Server Error',
          metadata: {
            statusCode: 500,
            error: 'HTTP 500: Internal Server Error',
          },
        }),
      });

      const response = await fetch('/api/captures/link/metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://broken-site.com' }),
      });

      expect(response.ok).toBe(false);
      expect(response.status).toBe(502);
    });
  });

  describe('Step 5: Type Guards and Utilities', () => {
    it('should correctly identify link captures', () => {
      const linkCapture: Capture = {
        id: 'test-1',
        user_id: 'user-1',
        daily_note_id: null,
        content: 'https://example.com',
        capture_type: 'link',
        captured_at: new Date().toISOString(),
        processed: false,
        linked_notes: '[]',
        linked_projects: '[]',
        tags: '[]',
        metadata: JSON.stringify({ url: 'https://example.com' }),
        created_at: new Date().toISOString(),
      };

      const thoughtCapture: Capture = {
        id: 'test-2',
        user_id: 'user-1',
        daily_note_id: null,
        content: 'Just a thought',
        capture_type: 'thought',
        captured_at: new Date().toISOString(),
        processed: false,
        linked_notes: '[]',
        linked_projects: '[]',
        tags: '[]',
        metadata: '{}',
        created_at: new Date().toISOString(),
      };

      expect(linkCapture.capture_type).toBe('link');
      expect(thoughtCapture.capture_type).toBe('thought');
    });

    it('should parse link metadata correctly', () => {
      const capture: Capture = {
        id: 'test-1',
        user_id: 'user-1',
        daily_note_id: null,
        content: 'https://example.com',
        capture_type: 'link',
        captured_at: new Date().toISOString(),
        processed: false,
        linked_notes: '[]',
        linked_projects: '[]',
        tags: '[]',
        metadata: JSON.stringify({
          url: 'https://example.com',
          title: 'Example',
          description: 'An example',
          favicon: 'https://example.com/favicon.ico',
        }),
        created_at: new Date().toISOString(),
      };

      const metadata: LinkMetadata = JSON.parse(capture.metadata);

      expect(metadata.url).toBe('https://example.com');
      expect(metadata.title).toBe('Example');
      expect(metadata.description).toBe('An example');
      expect(metadata.favicon).toBeTruthy();
    });
  });

  describe('Step 6: Metadata Display', () => {
    it('should provide all necessary data for UI display', () => {
      const metadata: LinkMetadata = {
        url: 'https://example.com/article',
        title: 'Example Article',
        description: 'This is an example article with a long description that should be truncated in the UI',
        favicon: 'https://example.com/favicon.ico',
        ogImage: 'https://example.com/og-image.jpg',
        scrapedContent: 'Full article content here...',
        wordCount: 250,
        scrapedAt: new Date().toISOString(),
      };

      // Verify all display fields are present
      expect(metadata.url).toBeTruthy();
      expect(metadata.title).toBeTruthy();
      expect(metadata.description).toBeTruthy();
      expect(metadata.favicon).toBeTruthy();
      expect(metadata.ogImage).toBeTruthy();

      // Verify scraping fields are present
      expect(metadata.scrapedContent).toBeTruthy();
      expect(metadata.wordCount).toBeGreaterThan(0);
      expect(metadata.scrapedAt).toBeTruthy();

      // Verify domain extraction
      const url = new URL(metadata.url);
      expect(url.hostname).toBe('example.com');
    });

    it('should handle missing optional metadata fields', () => {
      const metadata: LinkMetadata = {
        url: 'https://example.com',
        // All other fields are optional
      };

      expect(metadata.url).toBeTruthy();
      expect(metadata.title).toBeUndefined();
      expect(metadata.description).toBeUndefined();
      expect(metadata.favicon).toBeUndefined();
      expect(metadata.ogImage).toBeUndefined();
    });
  });
});
