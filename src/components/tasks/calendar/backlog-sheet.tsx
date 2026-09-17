"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Search } from "lucide-react";
import { useMediaQuery } from "@/hooks/use-media-query";
import { BacklogSidebar } from "./backlog-sidebar";
import { DraggableTask } from "./time-slot";
import type { Task } from "@/types/task";

interface BacklogSheetProps {
  tasks: Task[];
  onTaskClick: (task: Task) => void;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function BacklogSheet({ tasks, onTaskClick, isOpen = true, onOpenChange }: BacklogSheetProps) {
  const [sheetState, setSheetState] = useState<"hidden" | "peek" | "expanded">("peek");

  // Sync with parent's isOpen state
  const effectiveSheetState = !isOpen ? "hidden" : sheetState;
  const [searchQuery, setSearchQuery] = useState("");
  const [searchActive, setSearchActive] = useState(false);
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  // Filter to only unscheduled tasks
  const unscheduledTasks = useMemo(() => {
    return tasks.filter((task) => {
      if (task.scheduled_at) return false;
      if (task.status === "completed") return false;

      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const searchableText = `${task.title || task.content} ${task.project_name || ""}`.toLowerCase();
        return searchableText.includes(query);
      }

      return true;
    });
  }, [tasks, searchQuery]);

  // Desktop: Show as sidebar
  if (isDesktop) {
    return (
      <BacklogSidebar
        tasks={unscheduledTasks}
        onTaskClick={onTaskClick}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />
    );
  }

  // Mobile: Bottom sheet
  return (
    <>
      {/* Floating button when hidden - positioned near mic button */}
      {effectiveSheetState === "hidden" && unscheduledTasks.length > 0 && (
        <Button
          onClick={() => {
            setSheetState("peek");
            onOpenChange?.(true);
          }}
          className="fixed bottom-36 right-20 h-14 w-14 rounded-full shadow-2xl ring-2 ring-primary/20 z-[110]"
          size="icon"
        >
          <span className="text-base">📋</span>
        </Button>
      )}

      {/* Bottom sheet */}
      <Sheet
        open={effectiveSheetState !== "hidden"}
        onOpenChange={(open) => {
          setSheetState(open ? "peek" : "hidden");
          onOpenChange?.(open);
          // Reset search state when closing
          if (!open) {
            setSearchActive(false);
            setSearchQuery("");
          }
        }}
      >
        <SheetContent
          side="bottom"
          className="h-[60vh] rounded-t-2xl"
        >
          <SheetHeader>
            <SheetTitle>
              📋 Backlog ({unscheduledTasks.length} tasks)
            </SheetTitle>
          </SheetHeader>

          {/* Instructions for mobile drag */}
          <p className="text-xs text-muted-foreground text-center mb-2">
            Press and hold a task, then drag to schedule it
          </p>

          {/* Search */}
          <div className="flex gap-2 my-3">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Tap to search tasks..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onClick={() => setSearchActive(true)}
                onBlur={() => {
                  if (!searchQuery) {
                    setSearchActive(false);
                  }
                }}
                readOnly={!searchActive}
                className="pl-8"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
              />
            </div>
          </div>

          {/* Task list */}
          <div className="overflow-y-auto space-y-2">
            {unscheduledTasks.length === 0 ? (
              <div className="text-center py-12">
                <div className="text-6xl mb-4">✅</div>
                <h3 className="text-lg font-semibold mb-2">All Tasks Scheduled!</h3>
                <p className="text-sm text-muted-foreground">
                  You&apos;re all set. Time to execute!
                </p>
              </div>
            ) : (
              unscheduledTasks.map((task) => (
                <DraggableTask
                  key={task.id}
                  task={task}
                  onTaskClick={onTaskClick}
                />
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
