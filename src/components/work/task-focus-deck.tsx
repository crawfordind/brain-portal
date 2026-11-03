"use client";

/**
 * "Right now" on the Tasks page: the few open tasks that most need the user,
 * as cards you swipe through, led by the most pressing one in the Mind map's
 * warm aura. Ranked by `rankFocusTasks` (rules, each with its reason).
 *
 * One action per card, Done; tapping the card opens the task. Renders nothing
 * when nothing is pressing, so a calm list stays calm.
 */

import { useMemo } from "react";
import { format } from "date-fns";
import { Check, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SwipeDeck } from "@/components/ui/swipe-deck";
import { cn } from "@/lib/utils";
import { rankFocusTasks } from "@/lib/tasks/focus";
import type { Task } from "@/types/task";

const DOT = { late: "bg-red-500", now: "bg-amber-500", accent: "bg-primary" } as const;

export function TaskFocusDeck({
  tasks,
  onOpen,
  onComplete,
}: {
  tasks: Task[];
  onOpen: (task: Task) => void;
  onComplete: (id: string) => void;
}) {
  const picks = useMemo(() => rankFocusTasks(tasks, format(new Date(), "yyyy-MM-dd")), [tasks]);
  if (picks.length === 0) return null;

  return (
    <SwipeDeck label="Most important tasks right now">
      {picks.map((pick, i) => {
        const task = pick.task;
        const title = task.title || task.content;
        return (
          <article
            key={task.id}
            className={cn(
              "flex h-full flex-col rounded-2xl px-4 py-3",
              i === 0 ? "bp-focus" : "bp-surface"
            )}
          >
            <button
              type="button"
              onClick={() => onOpen(task)}
              className="min-w-0 flex-1 text-left outline-none focus-visible:underline"
            >
              <span className="flex min-h-6 items-center gap-2 text-sm text-muted-foreground sm:text-xs">
                <span aria-hidden="true" className={cn("h-2.5 w-2.5 shrink-0 rounded-full", DOT[pick.tone])} />
                <span
                  className={cn(
                    "bp-eyebrow shrink-0",
                    i === 0 ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground"
                  )}
                >
                  {i === 0 ? "Right now" : "Next"}
                </span>
                <span aria-hidden="true">·</span>
                <span className="truncate">{pick.reason}</span>
              </span>
              <span className="mt-1 line-clamp-2 block text-lg font-semibold leading-snug">{title}</span>
              {task.project_name && (
                <span className="mt-1 flex items-center gap-1 truncate text-sm text-muted-foreground">
                  <FolderOpen className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {task.project_name}
                </span>
              )}
            </button>
            <div className="mt-3">
              <Button
                className="h-11 rounded-full px-5 text-base sm:h-9 sm:text-sm"
                onClick={() => onComplete(task.id)}
                aria-label={`Done: ${title}`}
              >
                <Check className="mr-1.5 h-4 w-4" />
                Done
              </Button>
            </div>
          </article>
        );
      })}
    </SwipeDeck>
  );
}
