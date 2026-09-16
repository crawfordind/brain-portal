/**
 * Filter Types - Shared types for the advanced filtering system
 *
 * This module defines the filter configuration types used across
 * the application for consistent, reusable filtering.
 */

export type FilterType =
  | "select"      // Single selection from options
  | "multi"       // Multiple selections
  | "search"      // Text search with debounce
  | "date"        // Date picker
  | "dateRange"   // Date range picker
  | "toggle";     // Boolean toggle

export interface FilterOption {
  value: string;
  label: string;
  icon?: React.ReactNode;
  count?: number;
}

export interface FilterConfig {
  /** Unique identifier for this filter */
  id: string;
  /** Display label */
  label: string;
  /** Type of filter control */
  type: FilterType;
  /** Available options for select/multi types */
  options?: FilterOption[];
  /** Placeholder text for search/select */
  placeholder?: string;
  /** Default value */
  defaultValue?: string | string[] | boolean | null;
  /** Whether this filter is shown in the quick filter bar (desktop) */
  showInBar?: boolean;
  /** Icon to display */
  icon?: React.ReactNode;
}

export interface FilterState {
  [key: string]: string | string[] | boolean | null | undefined;
}

export interface FilterChangeHandler {
  (filterId: string, value: string | string[] | boolean | null): void;
}

export interface ActiveFilter {
  id: string;
  label: string;
  value: string;
  displayValue: string;
}

/**
 * Get active filters from state for display as chips/badges
 */
export function getActiveFilters(
  state: FilterState,
  configs: FilterConfig[]
): ActiveFilter[] {
  const active: ActiveFilter[] = [];

  for (const config of configs) {
    const value = state[config.id];

    if (value === undefined || value === null || value === "" || value === config.defaultValue) {
      continue;
    }

    if (config.type === "toggle" && value === false) {
      continue;
    }

    if (Array.isArray(value) && value.length === 0) {
      continue;
    }

    let displayValue = "";

    if (config.type === "select" && config.options) {
      const option = config.options.find(o => o.value === value);
      displayValue = option?.label || String(value);
    } else if (config.type === "multi" && Array.isArray(value) && config.options) {
      const labels = value.map(v => {
        const option = config.options?.find(o => o.value === v);
        return option?.label || v;
      });
      displayValue = labels.join(", ");
    } else if (config.type === "toggle") {
      displayValue = "Yes";
    } else {
      displayValue = String(value);
    }

    active.push({
      id: config.id,
      label: config.label,
      value: String(value),
      displayValue,
    });
  }

  return active;
}

/**
 * Build URL search params from filter state
 */
export function buildFilterParams(state: FilterState): URLSearchParams {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(state)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }

    if (Array.isArray(value)) {
      if (value.length > 0) {
        params.set(key, value.join(","));
      }
    } else if (typeof value === "boolean") {
      if (value) {
        params.set(key, "true");
      }
    } else {
      params.set(key, String(value));
    }
  }

  return params;
}

/**
 * Parse URL search params into filter state
 */
export function parseFilterParams(
  searchParams: URLSearchParams,
  configs: FilterConfig[]
): FilterState {
  const state: FilterState = {};

  for (const config of configs) {
    const value = searchParams.get(config.id);

    if (value === null) {
      state[config.id] = config.defaultValue ?? null;
      continue;
    }

    if (config.type === "multi") {
      state[config.id] = value.split(",").filter(Boolean);
    } else if (config.type === "toggle") {
      state[config.id] = value === "true";
    } else {
      state[config.id] = value;
    }
  }

  return state;
}
