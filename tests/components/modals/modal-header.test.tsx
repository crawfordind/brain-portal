import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ModalHeader } from '@/components/modals/modal-header';

describe('ModalHeader', () => {
  it('renders title', () => {
    render(<ModalHeader title="Test Title" />);
    expect(screen.getByText('Test Title')).toBeInTheDocument();
  });

  it('renders subtitle when provided', () => {
    render(<ModalHeader title="Title" subtitle="Subtitle text" />);
    expect(screen.getByText('Subtitle text')).toBeInTheDocument();
  });

  it('renders close button by default', () => {
    render(<ModalHeader title="Title" onClose={() => {}} />);
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
  });

  it('hides close button when showClose=false', () => {
    render(<ModalHeader title="Title" showClose={false} />);
    expect(screen.queryByRole('button', { name: /close/i })).not.toBeInTheDocument();
  });

  it('calls onClose when close button clicked', async () => {
    const onClose = vi.fn();
    render(<ModalHeader title="Title" onClose={onClose} />);

    const closeButton = screen.getByRole('button', { name: /close/i });
    await userEvent.click(closeButton);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('applies custom className', () => {
    render(<ModalHeader title="Title" className="custom-class" data-testid="header" />);
    const header = screen.getByTestId('header');
    expect(header).toHaveClass('custom-class');
  });
});
