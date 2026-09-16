import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { LazyDialog } from '@/components/ui/lazy-dialog';
import '@testing-library/jest-dom';

// Mock dialog component
const MockDialog = ({ open }: { open: boolean }) => (
  <div data-testid="mock-dialog">{open ? 'Dialog Open' : 'Dialog Closed'}</div>
);

describe('LazyDialog', () => {
  it('shows skeleton when dialog is loading', () => {
    const { container } = render(
      <LazyDialog
        open={true}
        loader={() => Promise.resolve({ default: MockDialog })}
      />
    );

    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('renders dialog after loading', async () => {
    render(
      <LazyDialog
        open={true}
        loader={() => Promise.resolve({ default: MockDialog })}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('mock-dialog')).toBeInTheDocument();
    });
  });

  it('does not load dialog when closed', () => {
    const loaderSpy = vi.fn();

    render(
      <LazyDialog
        open={false}
        loader={loaderSpy}
      />
    );

    expect(loaderSpy).not.toHaveBeenCalled();
  });

  it('loads dialog only when opened', async () => {
    const loaderSpy = vi.fn(() => Promise.resolve({ default: MockDialog }));

    const { rerender } = render(
      <LazyDialog open={false} loader={loaderSpy} />
    );

    expect(loaderSpy).not.toHaveBeenCalled();

    rerender(<LazyDialog open={true} loader={loaderSpy} />);

    await waitFor(() => {
      expect(loaderSpy).toHaveBeenCalledTimes(1);
    });
  });
});
