import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Share2, Trash2, Download } from 'lucide-react';
import { FloatingActions } from '@/components/modals/floating-actions';

describe('FloatingActions', () => {
  it('renders action buttons', () => {
    render(
      <FloatingActions
        actions={[
          { icon: <Share2 />, label: 'Share', onClick: vi.fn() },
          { icon: <Download />, label: 'Download', onClick: vi.fn() },
        ]}
      />
    );

    expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
  });

  it('calls onClick when clicked', async () => {
    const onClick = vi.fn();
    render(
      <FloatingActions
        actions={[
          { icon: <Share2 />, label: 'Share', onClick },
        ]}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('applies destructive variant', () => {
    render(
      <FloatingActions
        actions={[
          { icon: <Trash2 />, label: 'Delete', onClick: vi.fn(), variant: 'destructive' },
        ]}
      />
    );

    const button = screen.getByRole('button', { name: 'Delete' });
    expect(button).toHaveClass('bg-destructive');
  });

  it('positions at bottom by default', () => {
    const { container } = render(
      <FloatingActions
        actions={[
          { icon: <Share2 />, label: 'Share', onClick: vi.fn() },
        ]}
      />
    );

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper).toHaveClass('bottom-6');
    expect(wrapper).not.toHaveClass('top-6');
  });

  it('positions at top when specified', () => {
    const { container } = render(
      <FloatingActions
        position="top"
        actions={[
          { icon: <Share2 />, label: 'Share', onClick: vi.fn() },
        ]}
      />
    );

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper).toHaveClass('top-6');
    expect(wrapper).not.toHaveClass('bottom-6');
  });

  it('applies custom className', () => {
    const { container } = render(
      <FloatingActions
        className="custom-class"
        actions={[
          { icon: <Share2 />, label: 'Share', onClick: vi.fn() },
        ]}
      />
    );

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper).toHaveClass('custom-class');
  });

  it('disables button when disabled prop is true', () => {
    render(
      <FloatingActions
        actions={[
          { icon: <Share2 />, label: 'Share', onClick: vi.fn(), disabled: true },
        ]}
      />
    );

    const button = screen.getByRole('button', { name: 'Share' });
    expect(button).toBeDisabled();
  });

  it('does not call onClick when button is disabled', async () => {
    const onClick = vi.fn();
    render(
      <FloatingActions
        actions={[
          { icon: <Share2 />, label: 'Share', onClick, disabled: true },
        ]}
      />
    );

    const button = screen.getByRole('button', { name: 'Share' });
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
