import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AttachmentPicker } from '@/components/attachments/attachment-picker';
import '@testing-library/jest-dom';
import * as useMobileModule from '@/hooks/use-mobile';

// Mock fetch
global.fetch = vi.fn();

// Mock useMobile
vi.mock('@/hooks/use-mobile', () => ({
  useMobile: vi.fn(() => false),
}));

describe('AttachmentPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ attachments: [] }),
    });
  });

  it('renders dialog on desktop', () => {
    vi.mocked(useMobileModule.useMobile).mockReturnValue(false);

    render(
      <AttachmentPicker
        open={true}
        onClose={vi.fn()}
        onSelect={vi.fn()}
      />
    );

    expect(screen.getAllByText('Add Attachment').length).toBeGreaterThan(0);
  });

  it('renders bottom sheet on mobile', () => {
    vi.mocked(useMobileModule.useMobile).mockReturnValue(true);

    render(
      <AttachmentPicker
        open={true}
        onClose={vi.fn()}
        onSelect={vi.fn()}
      />
    );

    expect(screen.getAllByText('Add Attachment').length).toBeGreaterThan(0);
  });

  it('uses ModalHeader component', () => {
    vi.mocked(useMobileModule.useMobile).mockReturnValue(false);

    render(
      <AttachmentPicker
        open={true}
        onClose={vi.fn()}
        onSelect={vi.fn()}
      />
    );

    expect(screen.getByTestId('header')).toBeInTheDocument();
  });

  it('has action buttons in footer', () => {
    vi.mocked(useMobileModule.useMobile).mockReturnValue(false);

    render(
      <AttachmentPicker
        open={true}
        onClose={vi.fn()}
        onSelect={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /insert/i })).toBeInTheDocument();
  });
});
