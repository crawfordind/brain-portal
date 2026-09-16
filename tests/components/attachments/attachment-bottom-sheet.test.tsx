import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AttachmentBottomSheet } from '@/components/attachments/attachment-bottom-sheet';
import '@testing-library/jest-dom';

// Mock fetch
global.fetch = vi.fn();

describe('AttachmentBottomSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ attachments: [] }),
    });
  });

  it('uses ModalHeader component', () => {
    render(
      <AttachmentBottomSheet
        open={true}
        onClose={vi.fn()}
        onInsert={vi.fn()}
        noteId="note-1"
      />
    );

    expect(screen.getByTestId('header')).toBeInTheDocument();
  });

  it('has upload toggle button', () => {
    render(
      <AttachmentBottomSheet
        open={true}
        onClose={vi.fn()}
        onInsert={vi.fn()}
        noteId="note-1"
      />
    );

    expect(screen.getByRole('button', { name: /upload new/i })).toBeInTheDocument();
  });
});
