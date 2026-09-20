"use client";

/**
 * One row standing for one job's worth of writes.
 *
 * When an agent run writes twenty rows, the feed shows this instead of twenty
 * entries:
 *
 *     Claude Desktop · 23 notes and 4 tasks · 2:14pm – 2:41pm
 *
 * Nothing is hidden and nothing moved to another screen. Expanding renders the
 * rows themselves, at whatever density the viewer chose, with the same actions
 * they would have had on their own; archiving clears the whole batch at once,
 * which is the action the user actually wants after reading a summary.
 *
 * Collapsing is the point: the user asked for that work and wants it in the
 * stream. They just do not want it *shaped* as twenty unrelated thoughts
 * sitting on top of the one thing they came back to deal with.
 */

import { useState } from "react";
import { cn } from "@/lib/utils";
import { parseDbTimestamp, shortTimeLabel } from "@/lib/stream/grouping";
import { formatRunSummary, type StreamRun } from "@/lib/stream/runs";
import type { StreamDensity } from "@/lib/stream/density";
import { StreamItemCard, type StreamCardItem } from "./stream-item-card";
import { Button } from "@/components/ui/button";
import { Archive, ChevronRight, Layers } from "lucide-react";

/**
 * `StreamRun` is generic over the item so this component can stay pinned to
 * exactly what the row renderer needs, rather than loosening the type with an
 * index signature and casting at the call site.
 */
interface StreamRunCardProps {
  run: StreamRun<StreamCardItem>;
  density: StreamDensity;
  /** Any member of the run arrived since the viewer's last visit. */
  isNew?: boolean;
  onSelect?: (id: string) => void;
  onComplete?: (id: string) => void;
  onAskAbout?: (id: string) => void;
  onArchive?: (id: string) => void;
  onDismiss?: (id: string) => void;
  /** Archive every row the summary stands for. */
  onArchiveRun?: (ids: string[]) => void;
}

/**
 * "2:14pm – 2:41pm", or a single time when the run was quick enough that both
 * ends round to the same label. A range across two labels is the only part of
 * this row that tells the user how long the job took.
 */
function formatSpan(startedAt: string, endedAt: string, now: Date): string {
  const start = parseDbTimestamp(startedAt);
  const end = parseDbTimestamp(endedAt);
  if (!start || !end) return "";

  const startLabel = shortTimeLabel(start, now);
  const endLabel = shortTimeLabel(end, now);
  return startLabel === endLabel ? endLabel : `${startLabel} – ${endLabel}`;
}

export function StreamRunCard({
  run,
  density,
  isNew = false,
  onSelect,
  onComplete,
  onAskAbout,
  onArchive,
  onDismiss,
  onArchiveRun,
}: StreamRunCardProps) {
  const [expanded, setExpanded] = useState(false);

  const isCardDensity = density === "comfortable";
  const summary = formatRunSummary(run.typeCounts, { mayExtend: run.mayExtend });
  const span = formatSpan(run.startedAt, run.endedAt, new Date());
  const ids = run.items.map((item) => item.id);

  const header = (
    <div
      className={cn(
        "group relative flex items-center gap-2.5",
        isCardDensity
          ? "rounded-lg border bg-muted/30 px-3 py-2.5"
          : "rounded-md border-l-2 border-l-transparent py-1.5 pl-2 pr-1 hover:bg-muted/50"
      )}
    >
      {isNew && (
        <span
          className="absolute -left-2 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-primary"
          aria-label="New since your last visit"
        />
      )}

      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left outline-none"
      >
        <Layers
          className="h-4 w-4 shrink-0 text-muted-foreground"
          aria-hidden
        />

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm leading-tight">
            <span className="font-medium">{run.label}</span>
            <span className="text-muted-foreground"> wrote {summary}</span>
          </p>
          {isCardDensity && span && (
            <p className="mt-0.5 text-xs text-muted-foreground">{span}</p>
          )}
        </div>

        {!isCardDensity && span && (
          <time className="hidden shrink-0 tabular-nums text-xs text-muted-foreground sm:block">
            {span}
          </time>
        )}

        <ChevronRight
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-90"
          )}
          aria-hidden
        />
      </button>

      {onArchiveRun && (
        <Button
          size="icon"
          variant="ghost"
          className="h-11 w-11 shrink-0 -my-2 sm:h-8 sm:w-8 sm:my-0"
          onClick={(event) => {
            event.stopPropagation();
            onArchiveRun(ids);
          }}
          aria-label={`Archive all ${run.items.length} items from ${run.label}`}
        >
          <Archive className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
        </Button>
      )}
    </div>
  );

  if (!expanded) return header;

  return (
    <div className={isCardDensity ? "space-y-2" : undefined}>
      {header}
      {/* Indented and ruled so the rows read as belonging to the summary
          above them rather than as peers of the feed's other entries. */}
      <div
        className={cn(
          "ml-4 border-l pl-2",
          isCardDensity ? "mt-2 space-y-2" : "divide-y"
        )}
      >
        {run.items.map((item) => (
          <StreamItemCard
            key={item.id}
            item={item}
            density={density}
            onSelect={onSelect}
            onComplete={onComplete}
            onAskAbout={onAskAbout}
            onArchive={onArchive}
            onDismiss={onDismiss}
          />
        ))}
      </div>
    </div>
  );
}
