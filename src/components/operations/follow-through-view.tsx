"use client";

/**
 * Operations › Follow-through — the things that get lost in narrative notes:
 * decisions only the user can make, work stalled on someone else, and
 * promises in either direction.
 *
 * Every row is a task. Marking something "waiting on Will" here is the same
 * write an assistant makes through the `set_operational_state` MCP tool, so
 * the UI and a conversation always describe the same records.
 */

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { isLate, type FollowThroughView as View } from "@/lib/operations/classify";
import type { OpsItem } from "@/lib/operations/types";
import { OpsItemList } from "./ops-item-row";
import { OpsSectionCard } from "./ops-nav";
import { QuickAdd } from "./operations-home";

const VIEWS: { key: View; label: string; empty: string }[] = [
  {
    key: "decisions",
    label: "Decisions",
    empty: "No open decisions. Mark a task as a decision when the next step is a choice only you can make.",
  },
  {
    key: "waiting",
    label: "Waiting on",
    empty: "Nothing is waiting on anyone else.",
  },
  {
    key: "commitments",
    label: "Commitments",
    empty: "No open promises recorded, either way.",
  },
  {
    key: "blocked",
    label: "Blocked",
    empty: "Nothing is blocked.",
  },
];

interface ItemsResponse {
  today: string;
  view: View;
  items: OpsItem[];
  counts: Record<View, number>;
}

export function FollowThroughView() {
  const params = useSearchParams();
  const requested = params.get("view");
  const view: View = VIEWS.some((v) => v.key === requested) ? (requested as View) : "decisions";
  const meta = VIEWS.find((v) => v.key === view)!;

  const { data, isLoading, error } = useQuery<ItemsResponse>({
    queryKey: ["operations", "items", view],
    queryFn: async () => {
      const res = await fetch(`/api/operations/items?view=${view}`);
      if (!res.ok) throw new Error("Could not load");
      return res.json();
    },
    staleTime: 30_000,
  });

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg font-semibold">Follow-through</h1>
        <QuickAdd />
      </header>

      <div className="flex gap-2 overflow-x-auto scrollbar-none" role="tablist">
        {VIEWS.map((v) => (
          <Link
            key={v.key}
            href={`/operations/follow-through?view=${v.key}`}
            replace
            role="tab"
            aria-selected={v.key === view}
            className={cn(
              "flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs",
              v.key === view
                ? "border-primary bg-primary/10 font-medium text-primary"
                : "text-muted-foreground hover:bg-muted"
            )}
          >
            {v.label}
            {data?.counts?.[v.key] ? (
              <span className="tabular-nums opacity-80">{data.counts[v.key]}</span>
            ) : null}
          </Link>
        ))}
      </div>

      {isLoading ? (
        <Skeleton className="h-48 rounded-xl" />
      ) : error || !data ? (
        <p className="text-sm text-destructive">Could not load this list.</p>
      ) : (
        <Groups view={view} items={data.items} today={data.today} empty={meta.empty} />
      )}
    </div>
  );
}

function Groups({ view, items, today, empty }: { view: View; items: OpsItem[]; today: string; empty: string }) {
  if (items.length === 0) {
    return <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">{empty}</p>;
  }

  const groups: { title: string; hint?: string; items: OpsItem[] }[] = [];
  if (view === "waiting") {
    groups.push(
      { title: "Past the promised date", hint: "Time to chase", items: items.filter((i) => isLate(i, today)) },
      { title: "On time or undated", items: items.filter((i) => !isLate(i, today)) }
    );
  } else if (view === "commitments") {
    groups.push(
      { title: "You promised", items: items.filter((i) => i.ops.direction !== "they_owe") },
      { title: "Promised to you", items: items.filter((i) => i.ops.direction === "they_owe") }
    );
  } else if (view === "blocked") {
    groups.push(
      { title: "Blocked on you", hint: "Only you can unblock these", items: items.filter((i) => i.ops.blocked_by === "me") },
      { title: "Blocked by something else", items: items.filter((i) => i.ops.blocked_by !== "me") }
    );
  } else {
    groups.push({ title: "Open decisions", hint: "Earliest deadline first", items });
  }

  return (
    <div className="space-y-4">
      {groups
        .filter((g) => g.items.length > 0)
        .map((g) => (
          <OpsSectionCard key={g.title} title={g.title} count={g.items.length} hint={g.hint}>
            <OpsItemList items={g.items} today={today} showDetail />
          </OpsSectionCard>
        ))}
    </div>
  );
}
