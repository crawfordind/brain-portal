"use client";

/**
 * Operations › Automations — what runs in the background and whether it is
 * working, judged from the rows each job leaves behind.
 *
 * A job that keeps no trace is "Unknown", and n8n, which this app is not
 * connected to, is "Not connected". Neither is ever shown as healthy on faith.
 * The detailed, forwardable error report lives behind the header's alert
 * (System Health); this page is the map.
 */

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { CircleAlert, CircleCheck, CircleDashed, CircleOff, CirclePause, Plug } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { AUTOMATION_STATUS_LABELS, timeAgo } from "@/lib/operations/format";
import type { AutomationHealth, AutomationStatus } from "@/lib/operations/types";
import { OpsSectionCard } from "./ops-nav";

const STATUS_STYLE: Record<AutomationStatus, { icon: typeof CircleCheck; className: string }> = {
  healthy: { icon: CircleCheck, className: "text-emerald-600 dark:text-emerald-400" },
  degraded: { icon: CircleAlert, className: "text-amber-600 dark:text-amber-400" },
  failing: { icon: CircleOff, className: "text-destructive" },
  paused: { icon: CirclePause, className: "text-muted-foreground" },
  unknown: { icon: CircleDashed, className: "text-muted-foreground" },
  not_connected: { icon: Plug, className: "text-muted-foreground" },
};

export function AutomationRow({
  automation,
  compact = false,
}: {
  automation: AutomationHealth;
  compact?: boolean;
}) {
  const style = STATUS_STYLE[automation.status];
  const Icon = style.icon;
  const lastOk = timeAgo(automation.lastSuccessAt);
  const body = (
    <div className="flex items-start gap-2.5 py-2.5">
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", style.className)} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-medium">{automation.name}</span>
          <span className={cn("text-xs font-medium", style.className)}>
            {AUTOMATION_STATUS_LABELS[automation.status]}
          </span>
        </div>
        {automation.signal && <p className="text-xs text-foreground/80">{automation.signal}</p>}
        {!compact && <p className="text-xs text-muted-foreground">{automation.purpose}</p>}
        <p className="text-[11px] text-muted-foreground">
          {lastOk ? `Last success ${lastOk}` : automation.status === "not_connected" ? "" : "No success recorded"}
          {lastOk || automation.status !== "not_connected" ? " · " : ""}
          {automation.owner}
        </p>
      </div>
    </div>
  );
  return <li>{automation.href ? <Link href={automation.href} className="block hover:bg-muted/40">{body}</Link> : body}</li>;
}

export function AutomationsView() {
  const { data, isLoading, error } = useQuery<{ automations: AutomationHealth[]; checkedAt: string }>({
    queryKey: ["operations", "automations"],
    queryFn: async () => {
      const res = await fetch("/api/operations/automations");
      if (!res.ok) throw new Error("Could not load automations");
      return res.json();
    },
    staleTime: 30_000,
  });

  if (isLoading) return <Skeleton className="h-64 rounded-xl" />;
  if (error || !data) return <p className="text-sm text-destructive">Automations could not be loaded.</p>;

  const needs = data.automations.filter((a) => a.status === "failing" || a.status === "degraded");
  const rest = data.automations.filter((a) => !needs.includes(a));

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold">Automations</h1>
        <p className="text-xs text-muted-foreground">
          Judged from what each job leaves behind. Checked {timeAgo(data.checkedAt) ?? "just now"}.
        </p>
      </header>

      {needs.length > 0 ? (
        <OpsSectionCard title="Needs attention" count={needs.length} hint="Failing or degraded right now">
          <ul className="divide-y">
            {needs.map((a) => (
              <AutomationRow key={a.id} automation={a} />
            ))}
          </ul>
        </OpsSectionCard>
      ) : (
        <p className="flex items-center gap-2 rounded-xl border px-3.5 py-3 text-sm">
          <CircleCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          Nothing observable is failing.
        </p>
      )}

      <OpsSectionCard title="Everything else" count={rest.length}>
        <ul className="divide-y">
          {rest.map((a) => (
            <AutomationRow key={a.id} automation={a} />
          ))}
        </ul>
      </OpsSectionCard>
    </div>
  );
}
