"use client";

/**
 * AdvancedFilters - Unified mobile-first filtering component
 *
 * Combines FilterSheet (mobile) and FilterBar (desktop) into a single
 * responsive component that automatically shows the appropriate UI.
 *
 * MOBILE: Shows FilterSheet as a full-screen slide-up panel
 * DESKTOP: Shows FilterBar with inline controls
 */

import { useCallback, useMemo } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { FilterSheet, ActiveFilterChips } from "./filter-sheet";
import { FilterBar } from "./filter-bar";
import type { FilterConfig, FilterState, FilterChangeHandler } from "./filter-types";
import { buildFilterParams, parseFilterParams } from "./filter-types";

interface AdvancedFiltersProps {
  /** Filter configurations */
  filters: FilterConfig[];
  /** Optional: Use URL state management (default: true) */
  useUrlState?: boolean;
  /** Optional: Controlled state (when not using URL state) */
  state?: FilterState;
  /** Optional: Controlled onChange (when not using URL state) */
  onChange?: FilterChangeHandler;
  /** Optional: Controlled onClear (when not using URL state) */
  onClear?: () => void;
  /** Number of results for display */
  resultCount?: number;
  /** Search placeholder for desktop bar */
  searchPlaceholder?: string;
  /** Show only mobile sheet (useful for pages with custom desktop filters) */
  mobileOnly?: boolean;
  /** Show only desktop bar (useful for pages with custom mobile filters) */
  desktopOnly?: boolean;
}

export function AdvancedFilters({
  filters,
  useUrlState = true,
  state: controlledState,
  onChange: controlledOnChange,
  onClear: controlledOnClear,
  resultCount,
  searchPlaceholder,
  mobileOnly = false,
  desktopOnly = false,
}: AdvancedFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Parse state from URL if using URL state management
  const urlState = useMemo(() => {
    if (!useUrlState) return {};
    return parseFilterParams(searchParams, filters);
  }, [searchParams, filters, useUrlState]);

  // Use controlled state or URL state
  const state = controlledState ?? urlState;

  // Handle filter changes
  const handleChange: FilterChangeHandler = useCallback(
    (filterId, value) => {
      if (controlledOnChange) {
        controlledOnChange(filterId, value);
        return;
      }

      if (useUrlState) {
        const newState = { ...state, [filterId]: value };
        const params = buildFilterParams(newState);
        const queryString = params.toString();
        router.replace(queryString ? `${pathname}?${queryString}` : pathname);
      }
    },
    [controlledOnChange, useUrlState, state, pathname, router]
  );

  // Handle clear all filters
  const handleClear = useCallback(() => {
    if (controlledOnClear) {
      controlledOnClear();
      return;
    }

    if (useUrlState) {
      router.replace(pathname);
    }
  }, [controlledOnClear, useUrlState, pathname, router]);

  return (
    <div className="space-y-3">
      {/* MOBILE: Filter sheet button + active chips */}
      {!desktopOnly && (
        <div className="md:hidden space-y-3">
          <div className="flex items-center gap-2">
            <FilterSheet
              filters={filters}
              state={state}
              onChange={handleChange}
              onClear={handleClear}
              resultCount={resultCount}
            />
          </div>
          <ActiveFilterChips
            filters={filters}
            state={state}
            onChange={handleChange}
            onClear={handleClear}
          />
        </div>
      )}

      {/* DESKTOP: Inline filter bar */}
      {!mobileOnly && (
        <div className="hidden md:block">
          <FilterBar
            filters={filters}
            state={state}
            onChange={handleChange}
            onClear={handleClear}
            searchPlaceholder={searchPlaceholder}
          />
        </div>
      )}
    </div>
  );
}

/**
 * useFilters - Custom hook for filter state management
 *
 * Provides filter state and handlers that can be used with AdvancedFilters
 * or custom filter implementations.
 */
export function useFilters(filters: FilterConfig[], useUrlState = true) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Parse state from URL
  const state = useMemo(() => {
    if (!useUrlState) {
      // Return defaults
      const defaults: FilterState = {};
      for (const filter of filters) {
        defaults[filter.id] = filter.defaultValue ?? null;
      }
      return defaults;
    }
    return parseFilterParams(searchParams, filters);
  }, [searchParams, filters, useUrlState]);

  // Handle filter changes
  const onChange: FilterChangeHandler = useCallback(
    (filterId, value) => {
      if (!useUrlState) return;

      const newState = { ...state, [filterId]: value };
      const params = buildFilterParams(newState);
      const queryString = params.toString();
      router.replace(queryString ? `${pathname}?${queryString}` : pathname);
    },
    [useUrlState, state, pathname, router]
  );

  // Handle clear all
  const onClear = useCallback(() => {
    if (!useUrlState) return;
    router.replace(pathname);
  }, [useUrlState, pathname, router]);

  // Get a specific filter value with type safety
  const getValue = useCallback(
    <T extends string | string[] | boolean | null>(filterId: string): T => {
      return state[filterId] as T;
    },
    [state]
  );

  return {
    state,
    onChange,
    onClear,
    getValue,
  };
}

// Re-export types and utilities for convenience
export type { FilterConfig, FilterState, FilterOption, FilterType, FilterChangeHandler } from "./filter-types";
export { getActiveFilters, buildFilterParams, parseFilterParams } from "./filter-types";
