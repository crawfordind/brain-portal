import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CollapsibleSection } from '@/components/ui/collapsible-section';

describe('CollapsibleSection', () => {
  it('renders with title and children', () => {
    render(
      <CollapsibleSection title="Test Section">
        <div>Test Content</div>
      </CollapsibleSection>
    );

    expect(screen.getByText('Test Section')).toBeInTheDocument();
    expect(screen.getByText('Test Content')).toBeInTheDocument();
  });

  it('shows count badge when provided', () => {
    render(
      <CollapsibleSection title="Test Section" count={5}>
        <div>Content</div>
      </CollapsibleSection>
    );

    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('toggles collapsed state on click', () => {
    render(
      <CollapsibleSection title="Test Section">
        <div>Test Content</div>
      </CollapsibleSection>
    );

    const button = screen.getByRole('button');
    expect(screen.getByText('Test Content')).toBeInTheDocument();

    fireEvent.click(button);

    // Content should be removed from DOM after toggle
    expect(screen.queryByText('Test Content')).not.toBeInTheDocument();
  });

  it('respects defaultExpanded prop', () => {
    render(
      <CollapsibleSection title="Test Section" defaultExpanded={false}>
        <div>Test Content</div>
      </CollapsibleSection>
    );

    expect(screen.queryByText('Test Content')).not.toBeInTheDocument();
  });
});
