import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ModalSection } from '@/components/modals/modal-section';

describe('ModalSection', () => {
  it('renders title and content', () => {
    render(
      <ModalSection title="Test Section">
        <div>Test content</div>
      </ModalSection>
    );

    expect(screen.getByText('Test Section')).toBeInTheDocument();
    expect(screen.getByText('Test content')).toBeInTheDocument();
  });

  it('is expanded by default when defaultOpen is true', () => {
    render(
      <ModalSection title="Test Section" collapsible defaultOpen={true}>
        <div>Test content</div>
      </ModalSection>
    );

    expect(screen.getByText('Test content')).toBeVisible();
  });

  it('is collapsed when defaultOpen is false', () => {
    render(
      <ModalSection title="Test Section" collapsible defaultOpen={false}>
        <div>Test content</div>
      </ModalSection>
    );

    const content = screen.queryByText('Test content');
    expect(content).not.toBeInTheDocument();
  });

  it('toggles content visibility on click when collapsible', async () => {
    const user = userEvent.setup();

    render(
      <ModalSection title="Test Section" collapsible defaultOpen={true}>
        <div>Test content</div>
      </ModalSection>
    );

    expect(screen.getByText('Test content')).toBeVisible();

    const trigger = screen.getByRole('button');
    await user.click(trigger);

    expect(screen.queryByText('Test content')).not.toBeInTheDocument();

    await user.click(trigger);
    expect(screen.getByText('Test content')).toBeVisible();
  });

  it('shows chevron icon when collapsible', () => {
    render(
      <ModalSection title="Test Section" collapsible>
        <div>Test content</div>
      </ModalSection>
    );

    const trigger = screen.getByRole('button');
    const svg = trigger.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('does not show chevron icon when not collapsible', () => {
    render(
      <ModalSection title="Test Section">
        <div>Test content</div>
      </ModalSection>
    );

    const section = screen.getByText('Test Section').parentElement;
    const svg = section?.querySelector('svg');
    expect(svg).not.toBeInTheDocument();
  });

  it('renders as static section when not collapsible', () => {
    render(
      <ModalSection title="Test Section">
        <div>Test content</div>
      </ModalSection>
    );

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('Test content')).toBeVisible();
  });
});
