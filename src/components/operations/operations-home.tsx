"use client";

/**
 * Operations › Today — the command screen.
 *
 * Answers, in order: what needs me today, what is blocked, what only I can
 * decide, what I am waiting on, what I promised, what has a real deadline this
 * week, and whether anything in the background is broken.
 *
 * Bounded on purpose: each section shows a handful and says how many more
 * there are. A section with nothing in it renders nothing, and so does a
 * healthy set of automations — the reward for an empty queue is less screen.
 */

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Inbox, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { OperationsOverview, OpsKind } from "@/lib/operations/types";
import { OpsItemList } from "./ops-item-row";
import { OpsSectionCard } from "./ops-nav";
import { OpsEditDialog } from "./ops-edit-dialog";
import { AutomationRow } from "./automations-view";
import { useOpsActions } from "./use-ops-actions";

const LONG_DATE = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});

export function useOperationsOverview() {
  return useQuery<OperationsOverview>({
    queryKey: ["operations", "overview"],
    queryFn: async () => {
      const res = await fetch("/api/operations");
      if (!res.ok) throw new Error("Could not load operations");
      return res.json();
    },
    staleTime: 30_000,
  });
}

export function QuickAdd() {
  const [kind, setKind] = useState<OpsKind | null>(null);
  const { create } = useOpsActions();
  const choices: { kind: OpsKind; label: string }[] = [
    { kind: "decision", label: "Decision" },
    { kind: "waiting", label: "Waiting on" },
    { kind: "commitment", label: "Promise" },
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {choices.map((c) => (
        <Button
          key={c.kind}
          variant="outline"
          size="sm"
          className="h-9 gap-1.5"
          onClick={() => setKind(c.kind)}
        >
          <Plus className="h-3.5 w-3.5" /> {c.label}
        </Button>
      ))}
      <OpsEditDialog
        open={kind !== null}
        onOpenChange={(open) => !open && setKind(null)}
        initialKind={kind ?? undefined}
        pending={create.isPending}
        onSubmit={(values) =>
          create.mutate(
            { title: values.title, dueDate: values.dueDate, ops: values.ops },
            { onSuccess: () => setKind(null) }
          )
        }
      />
    </div>
  );
}

export function OperationsHome() {
  const { data, isLoading, error } = useOperationsOverview();

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
      </div>
    );
  }
  if (error || !data) {
    return <p className="text-sm text-destructive">Operations could not be loaded. Try again shortly.</p>;
  }

  const visible = data.sections.filter((s) => s.total > 0);
  const nothing = visible.length === 0;
  const today = data.today;

  const summary = [
    data.counts.overdue ? `${data.counts.overdue} overdue` : "",
    data.counts.decisions ? `${data.counts.decisions} to decide` : "",
    data.counts.blocked ? `${data.counts.blocked} blocked` : "",
    data.counts.waiting ? `${data.counts.waiting} waiting on others` : "",
  ].filter(Boolean);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">Operations</h1>
          <p className="text-xs text-muted-foreground">
            {LONG_DATE.format(Date.parse(`${today}T12:00:00Z`))}
            {summary.length > 0 && <> · {summary.join(" · ")}</>}
          </p>
        </div>
        <QuickAdd />
      </header>

      {data.automationAlerts.length > 0 && (
        <OpsSectionCard
          title="Systems need attention"
          count={data.automationAlerts.length}
          hint="Background jobs that are failing or degraded"
          action={
            <Link href="/operations/automations" className="shrink-0 whitespace-nowrap text-xs text-muted-foreground hover:text-foreground">
              All systems
            </Link>
          }
        >
          <ul className="divide-y">
            {data.automationAlerts.map((a) => (
              <AutomationRow key={a.id} automation={a} compact />
            ))}
          </ul>
        </OpsSectionCard>
      )}

      {data.intakeCount > 0 && (
        <Link
          href="/operations/intake"
          className="flex min-h-11 items-center gap-2 rounded-xl border border-primary/25 bg-primary/5 px-3.5 py-2 text-sm text-primary hover:bg-primary/10"
        >
          <Inbox className="h-4 w-4" />
          <span>
            <span className="font-medium tabular-nums">{data.intakeCount}</span> capture
            {data.intakeCount === 1 ? "" : "s"} to triage
          </span>
          <ArrowRight className="ml-auto h-4 w-4 opacity-70" />
        </Link>
      )}

      {data.counts.proposed > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5" />
          {data.counts.proposed} proposed item{data.counts.proposed === 1 ? "" : "s"} not yet confirmed — they
          are left off this screen until you confirm them.
        </p>
      )}

      {nothing ? (
        <div className="rounded-xl border border-dashed px-4 py-8 text-center">
          <p className="text-sm font-medium">Nothing is waiting on you.</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
            No overdue work, open decisions, blocks, or promises with dates. Tasks you mark as a
            decision, waiting on someone, or a promise will show up here.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {visible.map((section) => (
            <OpsSectionCard
              key={section.key}
              title={section.title}
              count={section.total}
              hint={section.hint}
              action={
                section.total > section.items.length && section.moreHref ? (
                  <Link
                    href={section.moreHref}
                    className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
                  >
                    +{section.total - section.items.length} more
                  </Link>
                ) : undefined
              }
            >
              <OpsItemList items={section.items} today={today} />
            </OpsSectionCard>
          ))}
        </div>
      )}
    </div>
  );
}
