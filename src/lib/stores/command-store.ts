import { create } from 'zustand';
import type { LucideIcon } from 'lucide-react';

export interface CommandResult {
  id: string;
  type: 'command' | 'note' | 'task' | 'capture' | 'project';
  label: string;
  description?: string;
  icon?: string | LucideIcon;
  section: 'commands' | 'recent' | 'search';
  url?: string;
  handler?: () => Promise<void> | void;
  keywords?: string[];
}

export interface CommandStore {
  // UI State
  isOpen: boolean;
  query: string;
  selectedIndex: number;
  results: CommandResult[];

  // Actions
  openPalette: () => void;
  closePalette: () => void;
  setQuery: (query: string) => void;
  setResults: (results: CommandResult[]) => void;
  moveSelection: (direction: 'up' | 'down') => void;
  executeSelected: () => Promise<void>;
  reset: () => void;
}

export const useCommandStore = create<CommandStore>((set, get) => ({
  // Initial state
  isOpen: false,
  query: '',
  selectedIndex: 0,
  results: [],

  // Actions
  openPalette: () => {
    set({ isOpen: true, selectedIndex: 0 });
  },

  closePalette: () => {
    set({ isOpen: false, query: '', selectedIndex: 0, results: [] });
  },

  setQuery: (query) => {
    set({ query, selectedIndex: 0 });
  },

  setResults: (results) => {
    set({ results, selectedIndex: 0 });
  },

  moveSelection: (direction) => {
    const { selectedIndex, results } = get();
    const maxIndex = results.length - 1;

    if (direction === 'up') {
      set({ selectedIndex: Math.max(0, selectedIndex - 1) });
    } else {
      set({ selectedIndex: Math.min(maxIndex, selectedIndex + 1) });
    }
  },

  executeSelected: async () => {
    const { results, selectedIndex, closePalette } = get();
    const selected = results[selectedIndex];

    if (!selected) return;

    // Execute handler if available
    if (selected.handler) {
      await selected.handler();
    }

    // Navigate if URL available
    if (selected.url && typeof window !== 'undefined') {
      window.location.href = selected.url;
    }

    // Close palette after execution
    closePalette();
  },

  reset: () => {
    set({
      isOpen: false,
      query: '',
      selectedIndex: 0,
      results: [],
    });
  },
}));
