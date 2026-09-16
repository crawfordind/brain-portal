import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dialog, DialogContent } from '@/components/ui/dialog';

describe('Dialog - Size Variants', () => {
  it('applies compact size class', () => {
    render(
      <Dialog open>
        <DialogContent size="compact" data-testid="dialog">
          Content
        </DialogContent>
      </Dialog>
    );

    const dialog = screen.getByTestId('dialog');
    expect(dialog).toHaveClass('sm:max-w-md');
  });

  it('applies standard size class', () => {
    render(
      <Dialog open>
        <DialogContent size="standard" data-testid="dialog">
          Content
        </DialogContent>
      </Dialog>
    );

    const dialog = screen.getByTestId('dialog');
    expect(dialog).toHaveClass('sm:max-w-2xl');
  });

  it('applies immersive size class', () => {
    render(
      <Dialog open>
        <DialogContent size="immersive" data-testid="dialog">
          Content
        </DialogContent>
      </Dialog>
    );

    const dialog = screen.getByTestId('dialog');
    expect(dialog).toHaveClass('sm:max-w-7xl');
  });

  it('defaults to standard size when not specified', () => {
    render(
      <Dialog open>
        <DialogContent data-testid="dialog">
          Content
        </DialogContent>
      </Dialog>
    );

    const dialog = screen.getByTestId('dialog');
    expect(dialog).toHaveClass('sm:max-w-2xl');
  });
});

describe('Dialog - Dismissible Behavior', () => {
  it('allows backdrop click to dismiss when dismissible=true', async () => {
    const onOpenChange = vi.fn();

    render(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent dismissible={true} data-testid="dialog">
          Content
        </DialogContent>
      </Dialog>
    );

    // Click on overlay (backdrop)
    const overlay = document.querySelector('[data-radix-dialog-overlay]') ||
                     document.querySelector('[data-slot="dialog-overlay"]');
    if (!overlay) {
      throw new Error('Dialog overlay not found');
    }
    await userEvent.click(overlay);

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('prevents backdrop click to dismiss when dismissible=false', async () => {
    const onOpenChange = vi.fn();

    render(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent dismissible={false} data-testid="dialog">
          Content
        </DialogContent>
      </Dialog>
    );

    // Click on overlay (backdrop)
    const overlay = document.querySelector('[data-radix-dialog-overlay]') ||
                     document.querySelector('[data-slot="dialog-overlay"]');
    if (!overlay) {
      throw new Error('Dialog overlay not found');
    }
    await userEvent.click(overlay);

    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('defaults to dismissible=true', async () => {
    const onOpenChange = vi.fn();

    render(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent data-testid="dialog">
          Content
        </DialogContent>
      </Dialog>
    );

    const overlay = document.querySelector('[data-radix-dialog-overlay]') ||
                     document.querySelector('[data-slot="dialog-overlay"]');
    if (!overlay) {
      throw new Error('Dialog overlay not found');
    }
    await userEvent.click(overlay);

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
