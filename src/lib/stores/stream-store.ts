/**
 * Stream Store - Global state for the agentic workflow
 *
 * Manages the Brain Bar state, stream filters, and active interactions.
 */

import { create } from "zustand";
import type {
  StreamItemType,
  StreamItemStatus,
  StreamFilter,
  IntentClassification,
  AgentType,
} from "@/lib/stream/types";

export interface StreamStore {
  // Brain Bar state
  brainBarInput: string;
  brainBarExpanded: boolean;
  isClassifying: boolean;
  classification: IntentClassification | null;
  linkedNoteIds: string[];
  isSubmitting: boolean;

  // Stream view state
  filter: StreamFilter;
  viewMode: "stream" | "focus" | "graph";
  selectedItemId: string | null;

  // Actions - Brain Bar
  setBrainBarInput: (input: string) => void;
  setBrainBarExpanded: (expanded: boolean) => void;
  setClassification: (c: IntentClassification | null) => void;
  setIsClassifying: (v: boolean) => void;
  setLinkedNoteIds: (ids: string[]) => void;
  setIsSubmitting: (v: boolean) => void;
  resetBrainBar: () => void;

  // Actions - Stream view
  setFilter: (filter: Partial<StreamFilter>) => void;
  resetFilter: () => void;
  toggleTypeFilter: (type: StreamItemType) => void;
  toggleStatusFilter: (status: StreamItemStatus) => void;
  setViewMode: (mode: "stream" | "focus" | "graph") => void;
  setSelectedItemId: (id: string | null) => void;
}

const defaultFilter: StreamFilter = {
  types: [],
  statuses: ["active", "processing", "waiting"],
  searchQuery: "",
};

export const useStreamStore = create<StreamStore>((set) => ({
  // Brain Bar initial state
  brainBarInput: "",
  brainBarExpanded: false,
  isClassifying: false,
  classification: null,
  linkedNoteIds: [],
  isSubmitting: false,

  // Stream view initial state
  filter: { ...defaultFilter },
  viewMode: "stream",
  selectedItemId: null,

  // Brain Bar actions
  setBrainBarInput: (input) => set({ brainBarInput: input }),
  setBrainBarExpanded: (expanded) => set({ brainBarExpanded: expanded }),
  setClassification: (c) => set({ classification: c }),
  setIsClassifying: (v) => set({ isClassifying: v }),
  setLinkedNoteIds: (ids) => set({ linkedNoteIds: ids }),
  setIsSubmitting: (v) => set({ isSubmitting: v }),
  resetBrainBar: () =>
    set({
      brainBarInput: "",
      brainBarExpanded: false,
      isClassifying: false,
      classification: null,
          linkedNoteIds: [],
      isSubmitting: false,
    }),

  // Stream view actions
  setFilter: (partial) =>
    set((state) => ({ filter: { ...state.filter, ...partial } })),
  resetFilter: () => set({ filter: { ...defaultFilter } }),
  toggleTypeFilter: (type) =>
    set((state) => {
      const types = state.filter.types.includes(type)
        ? state.filter.types.filter((t) => t !== type)
        : [...state.filter.types, type];
      return { filter: { ...state.filter, types } };
    }),
  toggleStatusFilter: (status) =>
    set((state) => {
      const statuses = state.filter.statuses.includes(status)
        ? state.filter.statuses.filter((s) => s !== status)
        : [...state.filter.statuses, status];
      return { filter: { ...state.filter, statuses } };
    }),
  setViewMode: (mode) => set({ viewMode: mode }),
  setSelectedItemId: (id) => set({ selectedItemId: id }),
}));
