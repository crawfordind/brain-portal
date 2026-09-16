import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProjectCreateDialog } from '@/components/projects/project-create-dialog';
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

describe('ProjectCreateDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders with ModalHeader and footer', () => {
    vi.mocked(useMobileModule.useMobile).mockReturnValue(false);

    render(
      <ProjectCreateDialog
        open={true}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByTestId('header')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create project/i })).toBeInTheDocument();
  });

  it('validates required name field', () => {
    vi.mocked(useMobileModule.useMobile).mockReturnValue(false);

    render(
      <ProjectCreateDialog
        open={true}
        onClose={vi.fn()}
      />
    );

    const createButton = screen.getByRole('button', { name: /create project/i });
    expect(createButton).toBeDisabled();
  });

  it('submits form with valid data', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ project: { id: '1', name: 'New project' } }),
    });

    vi.mocked(useMobileModule.useMobile).mockReturnValue(false);

    const onClose = vi.fn();
    render(
      <ProjectCreateDialog
        open={true}
        onClose={onClose}
      />
    );

    const nameInput = screen.getByPlaceholderText(/project name/i);
    fireEvent.change(nameInput, { target: { value: 'New project' } });

    const createButton = screen.getByRole('button', { name: /create project/i });
    fireEvent.click(createButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/projects', expect.objectContaining({
        method: 'POST',
      }));
      expect(onClose).toHaveBeenCalled();
    });
  });
});
