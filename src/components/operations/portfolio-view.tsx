"use client";

/**
 * Operations › Portfolio — which projects are living commitments and which
 * are reference, future ideas, or dormant.
 *
 * Projects are grouped into lanes by venture. A project's lane state is the
 * one the user chose, or one read from its status and labelled "from status".
 * "Looks dormant" is a suggestion only; nothing is reclassified until the user
 * taps it, and that tap writes one metadata key on one project (with Undo).
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { dateLabel, timeAgo } from "@/lib/operations/format";
import type { Portfolio, PortfolioProject, ProjectHealth } from "@/lib/operations/portfolio";
import { LANE_STATES, LANE_STATE_LABELS, type LaneState } from "@/lib/operations/types";
import { useOpsActions } from "./use-ops-actions";

type Filter = LaneState | "dormant";

const HEALTH: Record<ProjectHealth, { dot: string; label: string }> = {
  at_risk: { dot: "bg-destructive", label: "At risk" },
  attention: { dot: "bg-amber-500", label: "Needs you" },
  on_track: { dot: "bg-emerald-500", label: "On track" },
  quiet: { dot: "bg-muted-foreground/40", label: "Quiet" },
};

const OWNER_LABEL = { me: "You", other: "Someone else", system: "An automation" } as const;

export function PortfolioView() {
  const [filter, setFilter] = useState<Filter>("active");
  const { data, isLoading, error } = useQuery<Portfolio>({
    queryKey: ["operations", "portfolio"],
    queryFn: async () => {
      const res = await fetch("/api/operations/portfolio");
      if (!res.ok) throw new Error("Could not load portfolio");
      return res.json();
    },
    staleTime: 30_000,
  });

  const lanes = useMemo(() => {
    if (!data) return [];
    return data.lanes
      .map((lane) => ({
        ...lane,
        projects: lane.projects.filter((p) =>
          filter === "dormant" ? p.looksDormant : p.laneState === filter && !p.looksDormant
        ),
      }))
      .filter((lane) => lane.projects.length > 0);
  }, [data, filter]);

  if (isLoading) return <Skeleton className="h-64 rounded-xl" />;
  if (error || !data) return <p className="text-sm text-destructive">The portfolio could not be loaded.</p>;

  const filters: { key: Filter; label: string; count: number }[] = [
    ...LANE_STATES.map((s) => ({
      key: s as Filter,
      label: LANE_STATE_LABELS[s],
      count: s === "active" ? data.counts.active - data.counts.dormant : data.counts[s],
    })),
    { key: "dormant", label: "Looks dormant", count: data.counts.dormant },
  ];

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold">Portfolio</h1>
        <p className="text-xs text-muted-foreground">
          Every project, by venture. States marked &ldquo;from status&rdquo; were read from the project&apos;s
          status, not chosen — tap ⋯ to set one.
        </p>
      </header>

      <div className="flex gap-2 overflow-x-auto scrollbar-none">
        {filters.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
            className={cn(
              "flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs",
              filter === f.key
                ? "border-primary bg-primary/10 font-medium text-primary"
                : "text-muted-foreground hover:bg-muted"
            )}
          >
            {f.label}
            <span className="tabular-nums opacity-80">{f.count}</span>
          </button>
        ))}
      </div>

      {filter === "dormant" && lanes.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Marked active, nothing open, and nothing touched in 90 days. Nothing changes unless you
          choose a state for them.
        </p>
      )}

      {lanes.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          {data.lanes.length === 0
            ? "No projects yet."
            : `No projects are ${filter === "dormant" ? "flagged as dormant" : LANE_STATE_LABELS[filter].toLowerCase()}.`}
        </p>
      ) : (
        lanes.map((lane) => (
          <section key={lane.id} className="rounded-xl border bg-card">
            <header className="flex items-baseline justify-between gap-2 px-3.5 pt-3">
              <h2 className="text-sm font-semibold">
                {lane.href ? (
                  <Link href={lane.href} className="hover:underline">
                    {lane.name}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">{lane.name}</span>
                )}
              </h2>
              <span className="text-xs tabular-nums text-muted-foreground">{lane.projects.length}</span>
            </header>
            <ul className="divide-y px-3.5 pb-1">
              {lane.projects.map((p) => (
                <ProjectRow key={p.id} project={p} today={data.today} />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function ProjectRow({ project, today }: { project: PortfolioProject; today: string }) {
  const { setLane } = useOpsActions();
  const health = HEALTH[project.health];
  const next = dateLabel(project.nextDate, today);

  return (
    <li className="flex items-start gap-2 py-2.5">
      <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", health.dot)} title={health.label} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <Link href={project.href} className="text-sm font-medium hover:underline">
            {project.name}
          </Link>
          <span className="text-[11px] text-muted-foreground">
            {LANE_STATE_LABELS[project.laneState]}
            {!project.laneStateChosen && " (from status)"}
          </span>
          {project.looksDormant && (
            <span className="text-[11px] text-amber-600 dark:text-amber-400">Looks dormant</span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {health.label}: {project.healthReason}
        </p>
        {project.nextMove ? (
          <p className="mt-0.5 text-xs">
            <span className="text-muted-foreground">Next: </span>
            <Link href={project.nextMove.href} className="hover:underline">
              {project.nextMove.title}
            </Link>
            <span className="text-muted-foreground">
              {" "}
              · {project.nextMove.counterparty && project.nextMove.owner !== "me"
                ? project.nextMove.counterparty
                : OWNER_LABEL[project.nextMove.owner]}
            </span>
            {next && (
              <span className={cn("ml-1", next.tone === "late" ? "text-destructive" : "text-muted-foreground")}>
                · {next.text}
              </span>
            )}
          </p>
        ) : (
          <p className="mt-0.5 text-xs italic text-muted-foreground">No next step recorded</p>
        )}
        <p className="text-[11px] text-muted-foreground">
          {project.openCount} open · {project.noteCount} notes
          {project.contactCount > 0 && ` · ${project.contactCount} contacts`}
          {project.lastActivityAt && ` · active ${timeAgo(project.lastActivityAt)}`}
        </p>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="-my-1.5 h-11 w-11 shrink-0" aria-label={`Set state for ${project.name}`}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel className="text-xs">Mark as</DropdownMenuLabel>
          {LANE_STATES.map((s) => (
            <DropdownMenuItem
              key={s}
              disabled={project.laneStateChosen && project.laneState === s}
              onSelect={() => setLane.mutate({ projectId: project.id, laneState: s, name: project.name })}
            >
              {LANE_STATE_LABELS[s]}
            </DropdownMenuItem>
          ))}
          {project.laneStateChosen && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => setLane.mutate({ projectId: project.id, laneState: null, name: project.name })}
              >
                Use project status again
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
