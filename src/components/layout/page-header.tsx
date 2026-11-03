/**
 * One header for every page, in the stream's voice: a calm title and, under
 * it, one line that says what matters here right now ("2 overdue · 3 due
 * today"), not what the page is. Actions sit to the right and wrap below on a
 * phone.
 *
 * `SectionHeading` is the matching label for a group inside a page: a small
 * coloured dot, an uppercase eyebrow, a count and a pathway-style divider.
 */

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: ReactNode;
  /** What matters on this page now. Keep it to one line. */
  summary?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ title, summary, actions, className }: PageHeaderProps) {
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-x-4 gap-y-2", className)}>
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {summary && <p className="mt-0.5 text-sm text-muted-foreground">{summary}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export type SectionTone = "late" | "now" | "calm" | "done" | "accent";

const DOT: Record<SectionTone, string> = {
  late: "bg-red-500",
  now: "bg-amber-500",
  calm: "bg-muted-foreground/40",
  done: "bg-emerald-500",
  accent: "bg-primary",
};

const TEXT: Record<SectionTone, string> = {
  late: "text-red-600 dark:text-red-400",
  now: "text-amber-700 dark:text-amber-300",
  calm: "text-muted-foreground",
  done: "text-emerald-700 dark:text-emerald-300",
  accent: "text-primary",
};

export function SectionHeading({
  label,
  count,
  tone = "calm",
  sticky = false,
  as: Tag = "h2",
  className,
}: {
  label: string;
  count?: number;
  tone?: SectionTone;
  sticky?: boolean;
  as?: "h2" | "h3";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 py-1.5",
        sticky && "sticky top-0 z-20 -mx-1 bg-background/90 px-1 backdrop-blur",
        className
      )}
    >
      <span aria-hidden="true" className={cn("h-2 w-2 shrink-0 rounded-full", DOT[tone])} />
      <Tag className={cn("bp-eyebrow", TEXT[tone])}>{label}</Tag>
      {count !== undefined && (
        <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
      )}
      <span aria-hidden="true" className="nav-divider flex-1" />
    </div>
  );
}
