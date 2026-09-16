import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Sheet, SheetContent } from '@/components/ui/sheet';

describe('Sheet - Bottom Sheet Styling', () => {
  it('applies rounded top corners for bottom sheet', () => {
    render(
      <Sheet open>
        <SheetContent side="bottom" data-testid="sheet">
          Content
        </SheetContent>
      </Sheet>
    );

    const sheet = screen.getByTestId('sheet');
    expect(sheet).toHaveClass('rounded-t-2xl');
  });

  it('does not apply rounded corners for left/right sheets', () => {
    render(
      <Sheet open>
        <SheetContent side="right" data-testid="sheet">
          Content
        </SheetContent>
      </Sheet>
    );

    const sheet = screen.getByTestId('sheet');
    expect(sheet).not.toHaveClass('rounded-t-2xl');
  });
});
