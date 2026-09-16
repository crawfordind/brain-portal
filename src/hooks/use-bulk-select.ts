import { useState } from 'react';

export interface UseBulkSelectOptions {
  items: Array<{ id: string }>;
}

export interface UseBulkSelectReturn {
  selectedIds: Set<string>;
  toggleItem: (id: string) => void;
  selectAll: () => void;
  clearSelection: () => void;
  isSelected: (id: string) => boolean;
  selectedCount: number;
  hasSelection: boolean;
  allSelected: boolean;
}

/**
 * Hook for managing bulk selection state across list pages
 *
 * @example
 * const selection = useBulkSelect({ items: notes });
 *
 * // Check if item is selected
 * selection.isSelected(note.id)
 *
 * // Toggle item selection
 * selection.toggleItem(note.id)
 *
 * // Select all items
 * selection.selectAll()
 *
 * // Clear selection
 * selection.clearSelection()
 */
export function useBulkSelect({ items }: UseBulkSelectOptions): UseBulkSelectReturn {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggleItem = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(items.map(item => item.id)));
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
  };

  const isSelected = (id: string) => selectedIds.has(id);
  const selectedCount = selectedIds.size;
  const hasSelection = selectedIds.size > 0;
  const allSelected = items.length > 0 && selectedIds.size === items.length;

  return {
    selectedIds,
    toggleItem,
    selectAll,
    clearSelection,
    isSelected,
    selectedCount,
    hasSelection,
    allSelected,
  };
}
