import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { axe } from '../../setup-axe';
import { ModalSection } from '@/components/modals/modal-section';
import '@testing-library/jest-dom';

describe('ModalSection Accessibility', () => {
  it('has no accessibility violations', async () => {
    const { container } = render(
      <ModalSection title="Test Section">
        <div>Content</div>
      </ModalSection>
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('has proper group role', () => {
    const { getByRole } = render(
      <ModalSection title="Test Section">
        <div>Content</div>
      </ModalSection>
    );

    expect(getByRole('group')).toBeInTheDocument();
  });

  it('has aria-labelledby pointing to title', () => {
    const { getByRole, getByText } = render(
      <ModalSection title="Test Section">
        <div>Content</div>
      </ModalSection>
    );

    const group = getByRole('group');
    const title = getByText('Test Section');
    expect(group).toHaveAttribute('aria-labelledby', title.id);
  });

  it('has aria-expanded when collapsible', () => {
    const { getByRole } = render(
      <ModalSection title="Test Section" collapsible defaultOpen={false}>
        <div>Content</div>
      </ModalSection>
    );

    const button = getByRole('button');
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });
});
