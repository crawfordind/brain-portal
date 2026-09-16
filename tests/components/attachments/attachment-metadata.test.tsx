import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AttachmentMetadata } from '@/components/attachments/attachment-metadata';
import type { Attachment } from '@/lib/db/schema';

describe('AttachmentMetadata', () => {
  const baseAttachment: Attachment = {
    id: '1',
    user_id: 'test-user',
    filename: 'test.jpg',
    original_filename: 'test.jpg',
    file_type: 'image' as const,
    mime_type: 'image/jpeg',
    file_size: 1024000,
    storage_key: 'test-key',
    storage_url: 'https://example.com/test.jpg',
    project_id: null,
    note_id: null,
    created_at: '2024-01-15T10:30:00Z',
    updated_at: '2024-01-15T10:30:00Z',
    description: null,
    tags: '[]',
    extracted_text: null,
    metadata: '{}',
    content_plain: null,
    processing_status: 'completed',
    processing_error: null,
    content_hash: 'test-hash',
    is_pinned: false,
  };

  it('renders file details section', () => {
    render(<AttachmentMetadata attachment={baseAttachment} />);

    expect(screen.getByText('File Details')).toBeInTheDocument();
    expect(screen.getByText('Type')).toBeInTheDocument();
    expect(screen.getByText('image')).toBeInTheDocument();
    expect(screen.getByText('MIME Type')).toBeInTheDocument();
    expect(screen.getByText('image/jpeg')).toBeInTheDocument();
    expect(screen.getByText('Size')).toBeInTheDocument();
    expect(screen.getByText(/1000 KB/)).toBeInTheDocument();
  });

  it('renders description when provided', () => {
    const attachment = {
      ...baseAttachment,
      description: 'A test image',
    };

    render(<AttachmentMetadata attachment={attachment} />);
    expect(screen.getByText('Description')).toBeInTheDocument();
    expect(screen.getByText('A test image')).toBeInTheDocument();
  });

  it('renders tags when provided', () => {
    const attachment = {
      ...baseAttachment,
      tags: JSON.stringify(['nature', 'landscape']),
    };

    render(<AttachmentMetadata attachment={attachment} />);
    expect(screen.getByText('Tags')).toBeInTheDocument();
    expect(screen.getByText('nature')).toBeInTheDocument();
    expect(screen.getByText('landscape')).toBeInTheDocument();
  });

  it('renders extracted text preview', () => {
    const attachment = {
      ...baseAttachment,
      extracted_text: 'This is extracted text from the document.',
    };

    render(<AttachmentMetadata attachment={attachment} />);
    expect(screen.getByText('Extracted Text')).toBeInTheDocument();
    expect(screen.getByText('This is extracted text from the document.')).toBeInTheDocument();
  });

  it('renders image metadata when available', () => {
    const attachment = {
      ...baseAttachment,
      file_type: 'image' as const,
      metadata: JSON.stringify({
        width: 1920,
        height: 1080,
        format: 'JPEG',
      }),
    };

    render(<AttachmentMetadata attachment={attachment} />);
    expect(screen.getByText('Image Info')).toBeInTheDocument();
    expect(screen.getByText('Dimensions')).toBeInTheDocument();
    expect(screen.getByText('1920 × 1080')).toBeInTheDocument();
    expect(screen.getByText('Format')).toBeInTheDocument();
    expect(screen.getByText('JPEG')).toBeInTheDocument();
  });

  it('renders PDF metadata when available', () => {
    const attachment = {
      ...baseAttachment,
      file_type: 'pdf' as const,
      mime_type: 'application/pdf',
      metadata: JSON.stringify({
        numPages: 10,
      }),
    };

    render(<AttachmentMetadata attachment={attachment} />);
    expect(screen.getByText('PDF Info')).toBeInTheDocument();
    expect(screen.getByText('Pages')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
  });

  it('uses collapsible sections when collapsible prop is true', () => {
    const attachment = {
      ...baseAttachment,
      description: 'Test description',
      tags: JSON.stringify(['tag1']),
    };

    render(<AttachmentMetadata attachment={attachment} collapsible />);

    // ModalSection with collapsible renders ChevronDown icons
    const chevrons = document.querySelectorAll('svg');
    expect(chevrons.length).toBeGreaterThan(0);
  });

  it('renders modified date when different from created', () => {
    const attachment = {
      ...baseAttachment,
      updated_at: '2024-01-20T14:45:00Z',
    };

    render(<AttachmentMetadata attachment={attachment} />);
    expect(screen.getByText('Modified')).toBeInTheDocument();
  });
});
