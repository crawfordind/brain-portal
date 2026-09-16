import { describe, it, expect } from 'vitest';
import { isLinkCapture, type Capture, type LinkMetadata } from '@/lib/db/schema';

describe('Schema Type Guards', () => {
  describe('isLinkCapture', () => {
    it('should return true for link captures with valid metadata string', () => {
      const linkMetadata: LinkMetadata = {
        url: 'https://example.com',
        title: 'Example Site',
      };

      const capture: Capture = {
        id: '1',
        user_id: 'user1',
        daily_note_id: null,
        content: 'Check this out',
        capture_type: 'link',
        captured_at: '2024-01-01T00:00:00Z',
        processed: false,
        linked_notes: '[]',
        linked_projects: '[]',
        tags: '[]',
        metadata: JSON.stringify(linkMetadata),
        created_at: '2024-01-01T00:00:00Z',
      };

      expect(isLinkCapture(capture)).toBe(true);
    });

    it('should return false for non-link capture types', () => {
      const capture: Capture = {
        id: '1',
        user_id: 'user1',
        daily_note_id: null,
        content: 'Just a thought',
        capture_type: 'thought',
        captured_at: '2024-01-01T00:00:00Z',
        processed: false,
        linked_notes: '[]',
        linked_projects: '[]',
        tags: '[]',
        metadata: '{}',
        created_at: '2024-01-01T00:00:00Z',
      };

      expect(isLinkCapture(capture)).toBe(false);
    });

    it('should return false for link captures without url in metadata', () => {
      const capture: Capture = {
        id: '1',
        user_id: 'user1',
        daily_note_id: null,
        content: 'Link without URL',
        capture_type: 'link',
        captured_at: '2024-01-01T00:00:00Z',
        processed: false,
        linked_notes: '[]',
        linked_projects: '[]',
        tags: '[]',
        metadata: JSON.stringify({ title: 'No URL here' }),
        created_at: '2024-01-01T00:00:00Z',
      };

      expect(isLinkCapture(capture)).toBe(false);
    });

    it('should handle invalid JSON gracefully', () => {
      const capture: Capture = {
        id: '1',
        user_id: 'user1',
        daily_note_id: null,
        content: 'Malformed metadata',
        capture_type: 'link',
        captured_at: '2024-01-01T00:00:00Z',
        processed: false,
        linked_notes: '[]',
        linked_projects: '[]',
        tags: '[]',
        metadata: 'not valid json{',
        created_at: '2024-01-01T00:00:00Z',
      };

      expect(isLinkCapture(capture)).toBe(false);
    });

    it('should return true for link captures with already parsed metadata', () => {
      const linkMetadata: LinkMetadata = {
        url: 'https://example.com',
      };

      const capture = {
        id: '1',
        user_id: 'user1',
        daily_note_id: null,
        content: 'Check this out',
        capture_type: 'link' as const,
        captured_at: '2024-01-01T00:00:00Z',
        processed: false,
        linked_notes: '[]',
        linked_projects: '[]',
        tags: '[]',
        metadata: linkMetadata as any, // Simulating already parsed object
        created_at: '2024-01-01T00:00:00Z',
      };

      expect(isLinkCapture(capture as Capture)).toBe(true);
    });
  });
});
