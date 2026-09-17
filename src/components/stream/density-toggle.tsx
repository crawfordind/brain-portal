"use client";

/**
 * How tall a row is — the user's call.
 *
 * Sits at the end of the filter-chip row rather than in Settings, because it is
 * a thing you adjust *while looking at the list*, not a thing you go and
 * configure. Each option names what it costs you as well as what it is, so
 * "Compact" is not a guess.
 */

import { List, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  STREAM_DENSITIES,
  DENSITY_LABELS,
  type StreamDensity,
} from "@/lib/stream/density";

interface DensityToggleProps {
  density: StreamDensity;
  onChange: (next: StreamDensity) => void;
}

export function DensityToggle({ density, onChange }: DensityToggleProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-auto shrink-0 rounded-full border-dashed px-3 py-1.5 text-xs text-muted-foreground"
          aria-label={`Row density: ${DENSITY_LABELS[density].label}`}
        >
          <List className="h-3 w-3" />
          <span className="hidden sm:inline">{DENSITY_LABELS[density].label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {STREAM_DENSITIES.map((option) => {
          const { label, hint } = DENSITY_LABELS[option];
          const isActive = option === density;
          return (
            <DropdownMenuItem
              key={option}
              onClick={() => onChange(option)}
              className="gap-2"
            >
              <Check
                className={cn("h-3.5 w-3.5 shrink-0", !isActive && "opacity-0")}
                aria-hidden
              />
              <span className="flex flex-col">
                <span className="text-sm">{label}</span>
                <span className="text-[11px] text-muted-foreground">{hint}</span>
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
