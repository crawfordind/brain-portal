import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CaptureCreateDialog } from '@/components/captures/capture-create-dialog';
import '@testing-library/jest-dom';
import * as useMobileModule from '@/hooks/use-mobile';

// Mock fetch
global.fetch = vi.fn();

// Mock QueryClient
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
  }),
}));

// Mock useMobile
vi.mock('@/hooks/use-mobile', () => ({
  useMobile: vi.fn(() => false),
}));

describe('CaptureCreateDialog', () => {
  const mockProjects = [
    { id: '1', name: 'Project Alpha' },
    { id: '2', name: 'Project Beta' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders with ModalHeader and footer', () => {
    vi.mocked(useMobileModule.useMobile).mockReturnValue(false);

    render(
      <CaptureCreateDialog
        open={true}
        onClose={vi.fn()}
        projects={mockProjects}
      />
    );

    expect(screen.getByTestId('header')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /capture/i })).toBeInTheDocument();
  });

  it('validates required content field', () => {
    vi.mocked(useMobileModule.useMobile).mockReturnValue(false);

    render(
      <CaptureCreateDialog
        open={true}
        onClose={vi.fn()}
        projects={mockProjects}
      />
    );

    const captureButton = screen.getByRole('button', { name: /capture/i });
    expect(captureButton).toBeDisabled();
  });

  it('includes voice input component', () => {
    vi.mocked(useMobileModule.useMobile).mockReturnValue(false);

    render(
      <CaptureCreateDialog
        open={true}
        onClose={vi.fn()}
        projects={mockProjects}
      />
    );

    // VoiceInput should be rendered (it has a button with mic)
    const voiceButton = screen.getByRole('button', { name: /voice input/i });
    expect(voiceButton).toBeInTheDocument();
  });

  it('submits form with valid data', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ capture: { id: '1', content: 'New capture' } }),
    });

    vi.mocked(useMobileModule.useMobile).mockReturnValue(false);

    const onClose = vi.fn();
    render(
      <CaptureCreateDialog
        open={true}
        onClose={onClose}
        projects={mockProjects}
      />
    );

    const textarea = screen.getByPlaceholderText(/type or use voice input/i);
    fireEvent.change(textarea, { target: { value: 'New capture' } });

    const captureButton = screen.getByRole('button', { name: /capture/i });
    fireEvent.click(captureButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/captures', expect.objectContaining({
        method: 'POST',
      }));
      expect(onClose).toHaveBeenCalled();
    });
  });
});
