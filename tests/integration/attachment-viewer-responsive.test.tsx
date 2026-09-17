import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { AttachmentViewer } from '@/components/attachments/attachment-viewer';
import type { Attachment } from '@/lib/db/schema';

describe('AttachmentViewer - Responsive Integration', () => {
  const mockAttachment: Attachment = {
    id: '1',
    user_id: 'test-user',
    filename: 'responsive-test.jpg',
    original_filename: 'responsive-test.jpg',
    storage_key: 'test-key',
    storage_url: '/responsive-test.jpg',
    file_type: 'image' as const,
    mime_type: 'image/jpeg',
    file_size: 2048000,
    content_hash: 'content-hash',
    project_id: 'proj1',
    note_id: null,
    created_at: '2024-01-15T10:30:00Z',
    updated_at: '2024-01-20T14:30:00Z',
    description: 'Responsive test image',
    tags: JSON.stringify(['responsive', 'test']),
    extracted_text: 'Sample extracted text',
    metadata: JSON.stringify({ width: 2560, height: 1440, format: 'JPEG' }),
    content_plain: null,
    processing_status: 'completed',
    processing_error: null,
    is_pinned: false,
  };

  const originalInnerWidth = window.innerWidth;
  const originalMatchMedia = window.matchMedia;

  /**
   * Install a matchMedia stub whose `change` listeners the test can fire.
   *
   * `useMobile` calls matchMedia once inside an effect and then listens for
   * 'change' on the MediaQueryList it got. Replacing `window.matchMedia`
   * afterwards and dispatching a 'resize' event — which is what this suite used
   * to do — is invisible to the hook: it holds the old object and never hears
   * about resize at all. So the "switches to mobile" assertion was really
   * asserting that nothing had changed.
   */
  function installMatchMedia(initialMatches: boolean) {
    const listeners = new Set<(e: MediaQueryListEvent) => void>();

    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: initialMatches,
      media: query,
      addEventListener: (_: string, listener: (e: MediaQueryListEvent) => void) =>
        listeners.add(listener),
      removeEventListener: (_: string, listener: (e: MediaQueryListEvent) => void) =>
        listeners.delete(listener),
    }));

    return {
      /** Fire a real 'change', the way a browser reports a breakpoint crossing. */
      setMatches(matches: boolean) {
        act(() => {
          for (const listener of listeners) {
            listener({ matches } as MediaQueryListEvent);
          }
        });
      },
    };
  }

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: originalInnerWidth,
    });
    window.matchMedia = originalMatchMedia;
  });

  it('switches from desktop to mobile layout on resize', () => {
    // Start with desktop width
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1024,
    });

    const media = installMatchMedia(false);

    const { rerender } = render(
      <AttachmentViewer
        attachment={mockAttachment}
        isOpen={true}
        onClose={vi.fn()}
      />
    );

    // Should render desktop layout (Dialog)
    expect(document.querySelector('[role="dialog"]')).toHaveClass('sm:max-w-7xl');

    // Cross the breakpoint the way the browser reports it.
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 375,
    });
    media.setMatches(true);

    rerender(
      <AttachmentViewer
        attachment={mockAttachment}
        isOpen={true}
        onClose={vi.fn()}
      />
    );

    // Should render mobile layout (Sheet with rounded corners)
    expect(document.querySelector('[role="dialog"]')).toHaveClass('rounded-t-2xl');
  });

  it('renders all metadata sections correctly on desktop', () => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1024,
    });

    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));

    render(
      <AttachmentViewer
        attachment={mockAttachment}
        isOpen={true}
        onClose={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    // All metadata sections should be visible
    expect(screen.getByText('Description')).toBeInTheDocument();
    expect(screen.getByText('Responsive test image')).toBeInTheDocument();
    expect(screen.getByText('Tags')).toBeInTheDocument();
    expect(screen.getByText('responsive')).toBeInTheDocument();
    expect(screen.getByText('Extracted Text')).toBeInTheDocument();
    expect(screen.getByText('File Details')).toBeInTheDocument();
    expect(screen.getByText('Image Info')).toBeInTheDocument();
    expect(screen.getByText('2560 × 1440')).toBeInTheDocument();
  });

  it('renders collapsible metadata sections on mobile', () => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 375,
    });

    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: true,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));

    render(
      <AttachmentViewer
        attachment={mockAttachment}
        isOpen={true}
        onClose={vi.fn()}
      />
    );

    // Collapsible sections should have chevron indicators
    const chevrons = document.querySelectorAll('svg');
    const hasChevronDown = Array.from(chevrons).some(
      (svg) => svg.getAttribute('class')?.includes('rotate')
    );
    expect(hasChevronDown || chevrons.length > 5).toBe(true);
  });

  it('shows modified date when different from created date', () => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1024,
    });

    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));

    render(
      <AttachmentViewer
        attachment={mockAttachment}
        isOpen={true}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('Modified')).toBeInTheDocument();
  });

  it('renders all file type previews correctly', () => {
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));

    const fileTypes = [
      { type: 'image' as const, mime: 'image/png' },
      { type: 'pdf' as const, mime: 'application/pdf' },
      { type: 'audio' as const, mime: 'audio/mpeg' },
      { type: 'video' as const, mime: 'video/mp4' },
      { type: 'document' as const, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    ];

    fileTypes.forEach(({ type, mime }) => {
      const attachment: Attachment = {
        ...mockAttachment,
        filename: `test.${type}`,
        file_type: type,
        mime_type: mime,
      };

      const { unmount } = render(
        <AttachmentViewer
          attachment={attachment}
          isOpen={true}
          onClose={vi.fn()}
        />
      );

      // Verify preview component renders
      expect(document.querySelector('[role="dialog"]')).toBeInTheDocument();

      unmount();
    });
  });
});
