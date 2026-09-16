"use client";

/**
 * FilterBar - Desktop inline filter bar
 *
 * A horizontal filter bar for desktop that displays quick filters inline.
 * Supports search input, select dropdowns, and multi-select buttons.
 *
 * RESPONSIVE: Hidden on mobile, shown at md breakpoint and above
 */

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, X } from "lucide-react";
import type { FilterConfig, FilterState, FilterChangeHandler } from "./filter-types";
import { getActiveFilters } from "./filter-types";

interface FilterBarProps {
  /** Filter configurations (only showInBar=true will be displayed) */
  filters: FilterConfig[];
  /** Current filter state */
  state: FilterState;
  /** Handler for filter changes */
  onChange: FilterChangeHandler;
  /** Handler to clear all filters */
  onClear: () => void;
  /** Placeholder for search input */
  searchPlaceholder?: string;
}

export function FilterBar({
  filters,
  state,
  onChange,
  onClear,
  searchPlaceholder = "Search...",
}: FilterBarProps) {
  const barFilters = filters.filter((f) => f.showInBar);
  const activeFilters = getActiveFilters(state, filters);

  // Find search filter if present
  const searchFilter = barFilters.find((f) => f.type === "search");
  const otherFilters = barFilters.filter((f) => f.type !== "search");

  return (
    <div className="space-y-3">
      {/* Main filter row */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search input */}
        {searchFilter && (
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              placeholder={searchFilter.placeholder || searchPlaceholder}
              value={typeof state[searchFilter.id] === "string" ? state[searchFilter.id] as string : ""}
              onChange={(e) => onChange(searchFilter.id, e.target.value)}
              className="pl-10 h-9"
            />
          </div>
        )}

        {/* Other filters */}
        {otherFilters.map((filter) => (
          <FilterBarControl
            key={filter.id}
            config={filter}
            value={state[filter.id]}
            onChange={(value) => onChange(filter.id, value)}
          />
        ))}

        {/* Clear all button */}
        {activeFilters.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            className="text-muted-foreground h-9"
          >
            <X className="h-4 w-4 mr-1" />
            Clear
          </Button>
        )}
      </div>

      {/* Active filter chips - shown when there are filters not in bar */}
      <ActiveFilterBar
        filters={filters}
        state={state}
        onChange={onChange}
      />
    </div>
  );
}

interface FilterBarControlProps {
  config: FilterConfig;
  value: string | string[] | boolean | null | undefined;
  onChange: (value: string | string[] | boolean | null) => void;
}

function FilterBarControl({ config, value, onChange }: FilterBarControlProps) {
  switch (config.type) {
    case "select":
      return (
        <Select
          value={typeof value === "string" && value ? value : "__all__"}
          onValueChange={(val) => onChange(val === "__all__" ? null : val)}
        >
          <SelectTrigger className="w-[140px] h-9">
            <SelectValue placeholder={config.placeholder || config.label} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All {config.label}</SelectItem>
            {config.options?.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                <div className="flex items-center gap-2">
                  {option.icon}
                  <span>{option.label}</span>
                  {option.count !== undefined && (
                    <span className="text-muted-foreground">({option.count})</span>
                  )}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );

    case "multi":
      const selected = Array.isArray(value) ? value : [];
      return (
        <div className="flex flex-wrap gap-1.5">
          {config.options?.map((option) => {
            const isSelected = selected.includes(option.value);
            return (
              <Button
                key={option.value}
                variant={isSelected ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  if (isSelected) {
                    onChange(selected.filter((v) => v !== option.value));
                  } else {
                    onChange([...selected, option.value]);
                  }
                }}
                className="h-8 gap-1.5"
              >
                {option.icon}
                <span>{option.label}</span>
                {option.count !== undefined && (
                  <Badge
                    variant={isSelected ? "secondary" : "outline"}
                    className="ml-1 h-4 px-1 text-xs"
                  >
                    {option.count}
                  </Badge>
                )}
              </Button>
            );
          })}
        </div>
      );

    case "toggle":
      return (
        <Button
          variant={value === true ? "default" : "outline"}
          size="sm"
          onClick={() => onChange(value === true ? false : true)}
          className="h-9 gap-2"
        >
          {config.icon}
          <span>{config.label}</span>
        </Button>
      );

    default:
      return null;
  }
}

/**
 * ActiveFilterBar - Display active filters from non-bar filters
 */
interface ActiveFilterBarProps {
  filters: FilterConfig[];
  state: FilterState;
  onChange: FilterChangeHandler;
}

function ActiveFilterBar({ filters, state, onChange }: ActiveFilterBarProps) {
  // Only show chips for filters not in the bar
  const nonBarFilters = filters.filter((f) => !f.showInBar);
  const activeNonBarFilters = getActiveFilters(state, nonBarFilters);

  if (activeNonBarFilters.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted-foreground">Filtered by:</span>
      {activeNonBarFilters.map((filter) => (
        <Badge
          key={filter.id}
          variant="secondary"
          className="gap-1 pr-1 cursor-pointer hover:bg-secondary/80"
          onClick={() => {
            const config = filters.find((f) => f.id === filter.id);
            onChange(filter.id, config?.defaultValue ?? null);
          }}
        >
          <span className="text-muted-foreground">{filter.label}:</span>
          <span>{filter.displayValue}</span>
          <X className="h-3 w-3 ml-1" />
        </Badge>
      ))}
    </div>
  );
}
