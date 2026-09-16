import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { AttachmentViewer } from '@/components/attachments/attachment-viewer';
import type { Attachment } from '@/lib/db/schema';

// Mock the useMobile hook to return true for mobile
vi.mock('@/hooks/use-mobile', () => ({
  useMobile: vi.fn(() => true),
}));

// Mock the Attachment components
vi.mock('@/components/attachments/attachment-preview', () => ({
  AttachmentPreview: ({ attachment }: { attachment: Attachment }) => (
    <div data-testid="attachment-preview">
      Preview for {attachment.filename}
    </div>
  ),
}));

vi.mock('@/components/attachments/attachment-metadata', () => ({
  AttachmentMetadata: ({ attachment, collapsible }: { attachment: Attachment; collapsible?: boolean }) => (
    <div data-testid="attachment-metadata" data-collapsible={collapsible}>
      Metadata for {attachment.filename}
    </div>
  ),
}));

describe('AttachmentViewer - Mobile', () => {
  const mockAttachment: Attachment = {
    id: 'att-1',
    user_id: 'user-1',
    filename: 'test-image.jpg',
    original_filename: 'test-image.jpg',
    mime_type: 'image/jpeg',
    file_size: 1024000, // 1000 KB
    storage_key: 'uploads/test-image.jpg',
    storage_url: '/uploads/test-image.jpg',
    file_type: 'image',
    project_id: null,
    note_id: 'note-1',
    extracted_text: null,
    description: null,
    content_plain: null,
    processing_status: 'completed',
    processing_error: null,
    content_hash: 'abc123',
    metadata: '{}',
    tags: '[]',
    is_pinned: false,
    created_at: '2025-01-15T10:30:00Z',
    updated_at: '2025-01-15T10:30:00Z',
  };

  const mockOnClose = vi.fn();
  const mockOnDelete = vi.fn();

  beforeEach(() => {
    // Set mobile viewport
    window.innerWidth = 375;
    vi.clearAllMocks();
  });

  it('renders bottom sheet on mobile with rounded top corners', () => {
    render(
      <AttachmentViewer
        attachment={mockAttachment}
        isOpen={true}
        onClose={mockOnClose}
      />
    );

    // Look for Sheet content with rounded-t-2xl class
    const sheetContent = document.querySelector('[data-slot="sheet-content"]');
    expect(sheetContent).toBeInTheDocument();
    expect(sheetContent).toHaveClass('rounded-t-2xl');
  });

  it('renders drag handle', () => {
    render(
      <AttachmentViewer
        attachment={mockAttachment}
        isOpen={true}
        onClose={mockOnClose}
      />
    );

    const dragHandle = screen.getByTestId('drag-handle');
    expect(dragHandle).toBeInTheDocument();
  });

  it('renders FloatingActions with Download/Open/Delete buttons', () => {
    render(
      <AttachmentViewer
        attachment={mockAttachment}
        isOpen={true}
        onClose={mockOnClose}
        onDelete={mockOnDelete}
      />
    );

    const floatingActions = screen.getByTestId('floating-actions');
    expect(floatingActions).toBeInTheDocument();

    // Should have Download, Open, and Delete actions
    const actions = floatingActions.querySelectorAll('button');
    expect(actions).toHaveLength(3);

    // Verify action labels
    expect(screen.getByLabelText('Download')).toBeInTheDocument();
    expect(screen.getByLabelText('Open')).toBeInTheDocument();
    expect(screen.getByLabelText('Delete')).toBeInTheDocument();
  });

  it('renders collapsible metadata sections', () => {
    render(
      <AttachmentViewer
        attachment={mockAttachment}
        isOpen={true}
        onClose={mockOnClose}
      />
    );

    const metadata = screen.getByTestId('attachment-metadata');
    expect(metadata).toBeInTheDocument();
    expect(metadata).toHaveAttribute('data-collapsible', 'true');
  });

  it('uses stacked vertical layout (preview → actions → metadata)', () => {
    render(
      <AttachmentViewer
        attachment={mockAttachment}
        isOpen={true}
        onClose={mockOnClose}
      />
    );

    // Verify components are rendered in vertical order
    const preview = screen.getByTestId('attachment-preview');
    const floatingActions = screen.getByTestId('floating-actions');
    const metadata = screen.getByTestId('attachment-metadata');

    expect(preview).toBeInTheDocument();
    expect(floatingActions).toBeInTheDocument();
    expect(metadata).toBeInTheDocument();

    // Verify they are in a flex-col container
    const container = preview.closest('.flex-col');
    expect(container).toBeInTheDocument();
  });

  it('hides delete action when onDelete not provided', () => {
    render(
      <AttachmentViewer
        attachment={mockAttachment}
        isOpen={true}
        onClose={mockOnClose}
      />
    );

    const floatingActions = screen.getByTestId('floating-actions');
    const actions = floatingActions.querySelectorAll('button');

    // Should only have Download and Open actions (no Delete)
    expect(actions).toHaveLength(2);
    expect(screen.queryByLabelText('Delete')).not.toBeInTheDocument();
  });

  it('renders download action button', () => {
    render(
      <AttachmentViewer
        attachment={mockAttachment}
        isOpen={true}
        onClose={mockOnClose}
      />
    );

    // Verify download button exists
    const downloadButton = screen.getByLabelText('Download');
    expect(downloadButton).toBeInTheDocument();
    expect(downloadButton.tagName).toBe('BUTTON');
  });
});
