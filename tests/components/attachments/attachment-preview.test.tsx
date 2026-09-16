import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AttachmentPreview } from '@/components/attachments/attachment-preview';

describe('AttachmentPreview', () => {
  it('renders image preview', () => {
    const attachment = {
      id: '1',
      filename: 'test.jpg',
      storage_url: '/test.jpg',
      file_type: 'image' as const,
      mime_type: 'image/jpeg',
      file_size: 1024,
      processing_status: 'completed' as const,
    };

    render(<AttachmentPreview attachment={attachment} />);
    const img = screen.getByAltText('test.jpg');
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', '/test.jpg');
  });

  it('renders processing state', () => {
    const attachment = {
      id: '1',
      filename: 'test.jpg',
      storage_url: '/test.jpg',
      file_type: 'image' as const,
      mime_type: 'image/jpeg',
      file_size: 1024,
      processing_status: 'processing' as const,
    };

    render(<AttachmentPreview attachment={attachment} />);
    expect(screen.getByText('Processing file...')).toBeInTheDocument();
  });

  it('renders image error state', () => {
    const attachment = {
      id: '1',
      filename: 'test.jpg',
      storage_url: '/test.jpg',
      file_type: 'image' as const,
      mime_type: 'image/jpeg',
      file_size: 1024,
      processing_status: 'completed' as const,
    };

    render(<AttachmentPreview attachment={attachment} />);
    const img = screen.getByAltText('test.jpg') as HTMLImageElement;

    // Trigger error using fireEvent
    fireEvent.error(img);

    expect(screen.getByText('Failed to load image')).toBeInTheDocument();
  });

  it('renders PDF preview with iframe', () => {
    const attachment = {
      id: '1',
      filename: 'test.pdf',
      storage_url: '/test.pdf',
      file_type: 'pdf' as const,
      mime_type: 'application/pdf',
      file_size: 2048,
      processing_status: 'completed' as const,
    };

    render(<AttachmentPreview attachment={attachment} />);
    const iframe = screen.getByTitle('test.pdf');
    expect(iframe).toBeInTheDocument();
    expect(iframe).toHaveAttribute('src', '/test.pdf');
  });

  it('renders audio preview with controls', () => {
    const attachment = {
      id: '1',
      filename: 'test.mp3',
      storage_url: '/test.mp3',
      file_type: 'audio' as const,
      mime_type: 'audio/mpeg',
      file_size: 4096,
      processing_status: 'completed' as const,
    };

    const { container } = render(<AttachmentPreview attachment={attachment} />);
    const audio = container.querySelector('audio');
    expect(audio).toBeInTheDocument();
    expect(audio).toHaveAttribute('controls');
  });

  it('renders video preview with controls', () => {
    const attachment = {
      id: '1',
      filename: 'test.mp4',
      storage_url: '/test.mp4',
      file_type: 'video' as const,
      mime_type: 'video/mp4',
      file_size: 8192,
      processing_status: 'completed' as const,
    };

    const { container } = render(<AttachmentPreview attachment={attachment} />);
    const video = container.querySelector('video');
    expect(video).toBeInTheDocument();
    expect(video).toHaveAttribute('controls');
  });

  it('renders download prompt for unsupported document', () => {
    const attachment = {
      id: '1',
      filename: 'test.docx',
      storage_url: '/test.docx',
      file_type: 'document' as const,
      mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      file_size: 16384,
      processing_status: 'completed' as const,
    };

    render(<AttachmentPreview attachment={attachment} onDownload={vi.fn()} />);
    expect(screen.getByText('Preview not available')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /download/i })).toBeInTheDocument();
  });
});
