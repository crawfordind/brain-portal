import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { AttachmentViewer } from '@/components/attachments/attachment-viewer';
import type { Attachment } from '@/lib/db/schema';

// Mock the useMobile hook
vi.mock('@/hooks/use-mobile', () => ({
  useMobile: vi.fn(() => false), // Default to desktop
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
  AttachmentMetadata: ({ attachment }: { attachment: Attachment }) => (
    <div data-testid="attachment-metadata">
      Metadata for {attachment.filename}
    </div>
  ),
}));

describe('AttachmentViewer', () => {
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

  it('renders dialog with attachment details in header', () => {
    render(
      <AttachmentViewer
        attachment={mockAttachment}
        isOpen={true}
        onClose={mockOnClose}
      />
    );

    // Rendered twice by design: an sr-only dialog title plus the visible heading.
    expect(screen.getAllByText('test-image.jpg').length).toBeGreaterThan(0);
    expect(screen.getByText(/1000 KB/)).toBeInTheDocument();
  });

  it('renders AttachmentPreview component', () => {
    render(
      <AttachmentViewer
        attachment={mockAttachment}
        isOpen={true}
        onClose={mockOnClose}
      />
    );

    expect(screen.getByTestId('attachment-preview')).toBeInTheDocument();
    expect(screen.getByText('Preview for test-image.jpg')).toBeInTheDocument();
  });

  it('renders AttachmentMetadata component', () => {
    render(
      <AttachmentViewer
        attachment={mockAttachment}
        isOpen={true}
        onClose={mockOnClose}
      />
    );

    expect(screen.getByTestId('attachment-metadata')).toBeInTheDocument();
    expect(screen.getByText('Metadata for test-image.jpg')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    render(
      <AttachmentViewer
        attachment={mockAttachment}
        isOpen={true}
        onClose={mockOnClose}
      />
    );

    const closeButton = screen.getByLabelText('Close');
    await user.click(closeButton);

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('renders download button with correct href', () => {
    render(
      <AttachmentViewer
        attachment={mockAttachment}
        isOpen={true}
        onClose={mockOnClose}
      />
    );

    const downloadButton = screen.getByLabelText('Download');
    expect(downloadButton).toHaveAttribute('href', '/uploads/test-image.jpg');
    expect(downloadButton).toHaveAttribute('download', 'test-image.jpg');
  });

  it('renders open in new tab button with correct href', () => {
    render(
      <AttachmentViewer
        attachment={mockAttachment}
        isOpen={true}
        onClose={mockOnClose}
      />
    );

    const openButton = screen.getByLabelText('Open in new tab');
    expect(openButton).toHaveAttribute('href', '/uploads/test-image.jpg');
    expect(openButton).toHaveAttribute('target', '_blank');
  });

  it('does not render when isOpen is false', () => {
    render(
      <AttachmentViewer
        attachment={mockAttachment}
        isOpen={false}
        onClose={mockOnClose}
      />
    );

    expect(screen.queryByText('test-image.jpg')).not.toBeInTheDocument();
  });

  it('formats file size in subtitle', () => {
    const largeAttachment: Attachment = {
      ...mockAttachment,
      file_size: 5242880, // 5 MB
    };

    render(
      <AttachmentViewer
        attachment={largeAttachment}
        isOpen={true}
        onClose={mockOnClose}
      />
    );

    expect(screen.getByText(/5 MB/)).toBeInTheDocument();
  });

  it('shows MIME type in subtitle', () => {
    render(
      <AttachmentViewer
        attachment={mockAttachment}
        isOpen={true}
        onClose={mockOnClose}
      />
    );

    expect(screen.getByText(/image\/jpeg/)).toBeInTheDocument();
  });
});
