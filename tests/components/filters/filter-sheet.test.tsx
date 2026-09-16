import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FilterSheet } from '@/components/filters/filter-sheet';
import type { FilterConfig, FilterState } from '@/components/filters/filter-types';
import '@testing-library/jest-dom';

describe('FilterSheet', () => {
  const mockFilters: FilterConfig[] = [
    {
      id: 'status',
      type: 'select',
      label: 'Status',
      options: [
        { value: 'active', label: 'Active' },
        { value: 'completed', label: 'Completed' },
      ],
    },
    {
      id: 'search',
      type: 'search',
      label: 'Search',
      placeholder: 'Search...',
    },
  ];

  const mockState: FilterState = {
    status: null,
    search: '',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses ModalHeader component', () => {
    render(
      <FilterSheet
        filters={mockFilters}
        state={mockState}
        onChange={vi.fn()}
        onClear={vi.fn()}
      />
    );

    const trigger = screen.getByRole('button', { name: /filters/i });
    fireEvent.click(trigger);

    expect(screen.getByTestId('header')).toBeInTheDocument();
  });

  it('wraps each filter in ModalSection', () => {
    render(
      <FilterSheet
        filters={mockFilters}
        state={mockState}
        onChange={vi.fn()}
        onClear={vi.fn()}
      />
    );

    const trigger = screen.getByRole('button', { name: /filters/i });
    fireEvent.click(trigger);

    // ModalSection renders filter labels
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('Search')).toBeInTheDocument();
  });
});
