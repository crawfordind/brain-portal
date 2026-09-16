/**
 * Advanced Filters System
 *
 * A mobile-first, reusable filtering system for the Brain Portal application.
 *
 * Components:
 * - AdvancedFilters: Main component with responsive mobile/desktop views
 * - FilterSheet: Mobile full-screen filter panel
 * - FilterBar: Desktop inline filter bar
 * - ActiveFilterChips: Display active filters as removable chips
 *
 * Hooks:
 * - useFilters: Custom hook for filter state management with URL sync
 *
 * Usage:
 * ```tsx
 * import { AdvancedFilters, type FilterConfig } from "@/components/filters";
 *
 * const filters: FilterConfig[] = [
 *   { id: "search", label: "Search", type: "search", showInBar: true },
 *   { id: "type", label: "Type", type: "select", options: [...], showInBar: true },
 *   { id: "project", label: "Project", type: "multi", options: [...] },
 * ];
 *
 * <AdvancedFilters filters={filters} resultCount={100} />
 * ```
 */

// Main component
export { AdvancedFilters, useFilters } from "./advanced-filters";

// Individual components for custom implementations
export { FilterSheet, ActiveFilterChips } from "./filter-sheet";
export { FilterBar } from "./filter-bar";

// Types and utilities
export type {
  FilterConfig,
  FilterState,
  FilterOption,
  FilterType,
  FilterChangeHandler,
  ActiveFilter,
} from "./filter-types";

export {
  getActiveFilters,
  buildFilterParams,
  parseFilterParams,
} from "./filter-types";
