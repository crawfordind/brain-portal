import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ModalDragHandle } from '@/components/modals/modal-drag-handle';

describe('ModalDragHandle', () => {
  it('renders drag handle indicator', () => {
    render(<ModalDragHandle data-testid="drag-handle" />);

    const handle = screen.getByTestId('drag-handle');
    expect(handle).toBeInTheDocument();
  });

  it('applies correct styling for visual affordance', () => {
    render(<ModalDragHandle data-testid="drag-handle" />);

    const handle = screen.getByTestId('drag-handle');
    expect(handle).toHaveClass('w-12', 'h-1', 'rounded-full', 'bg-muted-foreground/20');
  });

  it('accepts custom className', () => {
    render(<ModalDragHandle className="custom-class" data-testid="drag-handle" />);

    const handle = screen.getByTestId('drag-handle');
    expect(handle).toHaveClass('custom-class');
  });
});
