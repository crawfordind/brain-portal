"use client";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StatusFilter } from "@/hooks/use-work-state";

interface Project {
  id: string;
  name: string;
}

interface MobileFilterSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  statusFilter: StatusFilter;
  onStatusFilterChange: (f: StatusFilter) => void;
  projectFilter: string;
  onProjectFilterChange: (p: string) => void;
  projects: Project[];
}

export function MobileFilterSheet({
  open,
  onOpenChange,
  statusFilter,
  onStatusFilterChange,
  projectFilter,
  onProjectFilterChange,
  projects,
}: MobileFilterSheetProps) {
  const statusOptions: { value: StatusFilter; label: string }[] = [
    { value: "open", label: "Open" },
    { value: "completed", label: "Done" },
    { value: "all", label: "All" },
  ];

  const hasActiveFilters = statusFilter !== "open" || projectFilter !== "all";

  const handleReset = () => {
    onStatusFilterChange("open");
    onProjectFilterChange("all");
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="px-4 pb-6">
        <SheetHeader className="px-0">
          <SheetTitle>Filters</SheetTitle>
        </SheetHeader>

        <div className="space-y-4 mt-2">
          {/* Status pills */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block uppercase tracking-wider">
              Status
            </label>
            <div className="flex items-center gap-0.5 p-0.5 bg-muted rounded-lg">
              {statusOptions.map((opt) => (
                <Button
                  key={opt.value}
                  variant={statusFilter === opt.value ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => {
                    onStatusFilterChange(opt.value);
                    onOpenChange(false);
                  }}
                  className="flex-1 h-9 text-sm"
                >
                  {opt.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Project dropdown */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block uppercase tracking-wider">
              Project
            </label>
            <Select
              value={projectFilter}
              onValueChange={(v) => {
                onProjectFilterChange(v);
                onOpenChange(false);
              }}
            >
              <SelectTrigger
                className={cn(
                  "w-full h-10",
                  projectFilter === "all" && "border-dashed"
                )}
              >
                <FolderOpen className="h-4 w-4 mr-2 text-muted-foreground shrink-0" />
                <SelectValue placeholder="All Projects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Projects</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Reset */}
          {hasActiveFilters && (
            <Button
              variant="outline"
              className="w-full h-10"
              onClick={handleReset}
            >
              Reset Filters
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
