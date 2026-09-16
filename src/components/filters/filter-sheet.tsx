"use client";

/**
 * FilterSheet - Mobile-first filter panel
 *
 * A full-screen sheet for mobile devices that displays all filter options.
 * Uses the Sheet component for smooth slide-in animation.
 *
 * MOBILE: Optimized for touch with 48px minimum touch targets
 * TOUCH: Large buttons and comfortable spacing
 */

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
  SheetFooter,
  SheetClose,
} from "@/components/ui/sheet";
import { SlidersHorizontal, X, Check } from "lucide-react";
import { ModalHeader } from "@/components/modals/modal-header";
import { ModalSection } from "@/components/modals/modal-section";
import { useState } from "react";
import type { FilterConfig, FilterState, FilterChangeHandler } from "./filter-types";
import { getActiveFilters } from "./filter-types";

interface FilterSheetProps {
  /** Filter configurations */
  filters: FilterConfig[];
  /** Current filter state */
  state: FilterState;
  /** Handler for filter changes */
  onChange: FilterChangeHandler;
  /** Handler to clear all filters */
  onClear: () => void;
  /** Number of results (optional) */
  resultCount?: number;
}

export function FilterSheet({
  filters,
  state,
  onChange,
  onClear,
  resultCount,
}: FilterSheetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const activeFilters = getActiveFilters(state, filters);

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        {/* TOUCH: min-h-11 for comfortable tapping */}
        <Button variant="outline" className="min-h-11 gap-2">
          <SlidersHorizontal className="h-4 w-4" />
          <span>Filters</span>
          {activeFilters.length > 0 && (
            <Badge variant="secondary" className="ml-1 h-5 px-1.5">
              {activeFilters.length}
            </Badge>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="h-[85vh] p-0 gap-0">
        <SheetTitle className="sr-only">Filters</SheetTitle>
        <div className="flex flex-col h-full">
          <div className="p-4 border-b">
            <div className="flex items-center justify-between mb-2">
              <ModalHeader
                title="Filters"
                onClose={() => setIsOpen(false)}
                showClose={false}
              />
              {activeFilters.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onClear}
                  className="text-muted-foreground"
                >
                  Clear all
                </Button>
              )}
            </div>
            {resultCount !== undefined && (
              <p className="text-sm text-muted-foreground">
                {resultCount} {resultCount === 1 ? "result" : "results"}
              </p>
            )}
          </div>

          {/* Scrollable filter content */}
          <div className="flex-1 overflow-y-auto p-4 space-y-6">
            {filters.map((filter) => (
              <ModalSection key={filter.id} title={filter.label}>
                <FilterControl
                  config={filter}
                  value={state[filter.id]}
                  onChange={(value) => onChange(filter.id, value)}
                />
              </ModalSection>
            ))}
          </div>

          <SheetFooter className="border-t pt-4 flex-row gap-2 p-4">
            <SheetClose asChild>
              <Button variant="outline" className="flex-1 min-h-12">
                Cancel
              </Button>
            </SheetClose>
            <SheetClose asChild>
              <Button className="flex-1 min-h-12">
                <Check className="h-4 w-4 mr-2" />
                Apply Filters
              </Button>
            </SheetClose>
          </SheetFooter>
        </div>
      </SheetContent>
    </Sheet>
  );
}

interface FilterControlProps {
  config: FilterConfig;
  value: string | string[] | boolean | null | undefined;
  onChange: (value: string | string[] | boolean | null) => void;
}

function FilterControl({ config, value, onChange }: FilterControlProps) {
  switch (config.type) {
    case "select":
      return (
        <div className="flex flex-wrap gap-2">
            {config.options?.map((option) => {
              const isSelected = value === option.value;
              return (
                <Button
                  key={option.value}
                  variant={isSelected ? "default" : "outline"}
                  size="sm"
                  onClick={() => onChange(isSelected ? null : option.value)}
                  className="min-h-10 gap-2"
                >
                  {option.icon}
                  <span>{option.label}</span>
                  {option.count !== undefined && (
                    <Badge variant={isSelected ? "secondary" : "outline"} className="ml-1">
                      {option.count}
                    </Badge>
                  )}
                </Button>
              );
            })}
        </div>
      );

    case "multi":
      return (
        <div className="flex flex-wrap gap-2">
            {config.options?.map((option) => {
              const selected = Array.isArray(value) ? value : [];
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
                  className="min-h-10 gap-2"
                >
                  {option.icon}
                  <span>{option.label}</span>
                  {option.count !== undefined && (
                    <Badge variant={isSelected ? "secondary" : "outline"} className="ml-1">
                      {option.count}
                    </Badge>
                  )}
                </Button>
              );
            })}
        </div>
      );

    case "search":
      return (
        <Input
          type="text"
          placeholder={config.placeholder || "Search..."}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          className="h-11"
        />
      );

    case "toggle":
      return (
        <div className="flex items-center justify-between min-h-12">
          {config.placeholder && (
            <p className="text-xs text-muted-foreground">{config.placeholder}</p>
          )}
          <Switch
            checked={value === true}
            onCheckedChange={(checked) => onChange(checked)}
            className="ml-auto"
          />
        </div>
      );

    default:
      return null;
  }
}

/**
 * ActiveFilterChips - Display active filters as removable chips
 *
 * MOBILE: Horizontally scrollable on small screens
 */
interface ActiveFilterChipsProps {
  filters: FilterConfig[];
  state: FilterState;
  onChange: FilterChangeHandler;
  onClear: () => void;
}

export function ActiveFilterChips({
  filters,
  state,
  onChange,
  onClear,
}: ActiveFilterChipsProps) {
  const activeFilters = getActiveFilters(state, filters);

  if (activeFilters.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-2 -mx-4 px-4 md:mx-0 md:px-0 md:overflow-visible scrollbar-hide">
      {activeFilters.map((filter) => (
        <Badge
          key={filter.id}
          variant="secondary"
          className="shrink-0 gap-1 pr-1 cursor-pointer hover:bg-secondary/80"
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
      {activeFilters.length > 1 && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onClear}
          className="shrink-0 h-6 px-2 text-xs text-muted-foreground"
        >
          Clear all
        </Button>
      )}
    </div>
  );
}
