import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ModalFooter } from '@/components/modals/modal-footer';

describe('ModalFooter', () => {
  it('renders primary action', () => {
    render(
      <ModalFooter
        primaryAction={{ label: 'Save', onClick: vi.fn() }}
      />
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('renders secondary action when provided', () => {
    render(
      <ModalFooter
        primaryAction={{ label: 'Save', onClick: vi.fn() }}
        secondaryAction={{ label: 'Cancel', onClick: vi.fn() }}
      />
    );
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('calls primaryAction onClick handler', async () => {
    const onClick = vi.fn();
    render(
      <ModalFooter
        primaryAction={{ label: 'Save', onClick }}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('disables primary button when loading', () => {
    render(
      <ModalFooter
        primaryAction={{ label: 'Save', onClick: vi.fn(), loading: true }}
      />
    );
    const button = screen.getByRole('button', { name: /save/i });
    expect(button).toBeDisabled();
  });

  it('shows loading text when primary button loading', () => {
    render(
      <ModalFooter
        primaryAction={{ label: 'Save', onClick: vi.fn(), loading: true, loadingText: 'Saving...' }}
      />
    );
    expect(screen.getByText('Saving...')).toBeInTheDocument();
  });

  it('applies destructive variant to primary action', () => {
    render(
      <ModalFooter
        primaryAction={{ label: 'Delete', onClick: vi.fn(), variant: 'destructive' }}
      />
    );
    const button = screen.getByRole('button', { name: 'Delete' });
    expect(button).toHaveClass('bg-destructive');
  });
});
