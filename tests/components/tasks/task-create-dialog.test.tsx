import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders as render } from '../../helpers/render';
import { TaskCreateDialog } from '@/components/tasks/task-create-dialog';
import '@testing-library/jest-dom';
import * as useMobileModule from '@/hooks/use-mobile';

// Mock fetch
global.fetch = vi.fn();

// Mock QueryClient
// Mock useMobile
vi.mock('@/hooks/use-mobile', () => ({
  useMobile: vi.fn(() => false),
}));

describe('TaskCreateDialog', () => {
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
      <TaskCreateDialog
        open={true}
        onClose={vi.fn()}
        projects={mockProjects}
      />
    );

    expect(screen.getByTestId('header')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create task/i })).toBeInTheDocument();
  });

  it('validates required content field', () => {
    vi.mocked(useMobileModule.useMobile).mockReturnValue(false);

    render(
      <TaskCreateDialog
        open={true}
        onClose={vi.fn()}
        projects={mockProjects}
      />
    );

    const createButton = screen.getByRole('button', { name: /create task/i });
    expect(createButton).toBeDisabled();
  });

  it('submits form with valid data', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ task: { id: '1', content: 'New task' } }),
    });

    vi.mocked(useMobileModule.useMobile).mockReturnValue(false);

    const onClose = vi.fn();
    render(
      <TaskCreateDialog
        open={true}
        onClose={onClose}
        projects={mockProjects}
      />
    );

    const input = screen.getByPlaceholderText(/enter task description/i);
    fireEvent.change(input, { target: { value: 'New task' } });

    const createButton = screen.getByRole('button', { name: /create task/i });
    fireEvent.click(createButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/tasks', expect.objectContaining({
        method: 'POST',
      }));
      expect(onClose).toHaveBeenCalled();
    });
  });
});
