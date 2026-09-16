import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { axe } from '../../setup-axe';
import { ModalHeader } from '@/components/modals/modal-header';
import '@testing-library/jest-dom';

describe('ModalHeader Accessibility', () => {
  it('has no accessibility violations', async () => {
    const { container } = render(
      <ModalHeader title="Test Dialog" onClose={vi.fn()} />
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('has proper heading role and level', () => {
    const { getByText } = render(
      <ModalHeader title="Test Dialog" onClose={vi.fn()} />
    );

    const heading = getByText('Test Dialog');
    expect(heading).toHaveAttribute('role', 'heading');
    expect(heading).toHaveAttribute('aria-level', '2');
  });

  it('provides id for aria-labelledby reference', () => {
    const { getByText } = render(
      <ModalHeader title="Test Dialog" onClose={vi.fn()} id="dialog-title" />
    );

    const heading = getByText('Test Dialog');
    expect(heading).toHaveAttribute('id', 'dialog-title');
  });

  it('close button has accessible label', () => {
    const { getByLabelText } = render(
      <ModalHeader title="Test Dialog" onClose={vi.fn()} />
    );

    expect(getByLabelText('Close dialog')).toBeInTheDocument();
  });
});
