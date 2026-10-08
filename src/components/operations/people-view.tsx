"use client";

/**
 * Operations › People — who the user is in the middle of something with.
 *
 * Built on the CRM, not beside it: every named contact links to its full
 * record at `/crm/[id]`, where the mention and touch timeline lives. This view
 * only adds the two columns a Rolodex lacks: what you owe them, and what they
 * owe you.
 */

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { dateLabel, timeAgo } from "@/lib/operations/format";
import type { RelationshipRow, RelationshipsView } from "@/lib/operations/people";
import type { OpsItem } from "@/lib/operations/types";

interface VentureOption {
  entity: { id: string; canonical_name: string };
}

export function PeopleView() {
  const [ventureId, setVentureId] = useState<string>("");

  const { data: ventures } = useQuery<{ ventures: VentureOption[] }>({
    queryKey: ["crm", "ventures"],
    queryFn: async () => {
      const res = await fetch("/api/crm/ventures");
      if (!res.ok) return { ventures: [] };
      return res.json();
    },
  });

  const { data, isLoading, error } = useQuery<RelationshipsView>({
    queryKey: ["operations", "people", ventureId],
    queryFn: async () => {
      const qs = ventureId ? `?ventureId=${encodeURIComponent(ventureId)}` : "";
      const res = await fetch(`/api/operations/people${qs}`);
      if (!res.ok) throw new Error("Could not load");
      return res.json();
    },
    staleTime: 30_000,
  });

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">People</h1>
          <p className="text-xs text-muted-foreground">
            Anyone with something open either way, a follow-up due, or a touch in the last 30 days.
          </p>
        </div>
        {ventures?.ventures?.length ? (
          <select
            value={ventureId}
            onChange={(e) => setVentureId(e.target.value)}
            className="h-9 rounded-md border bg-background px-2 text-sm"
            aria-label="Filter by venture"
          >
            <option value="">All ventures</option>
            {ventures.ventures.map((v) => (
              <option key={v.entity.id} value={v.entity.id}>
                {v.entity.canonical_name}
              </option>
            ))}
          </select>
        ) : null}
      </header>

      {isLoading ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : error || !data ? (
        <p className="text-sm text-destructive">Relationships could not be loaded.</p>
      ) : data.rows.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          Nobody has anything open with you. When you mark a task as waiting on someone, or record a
          promise, they appear here.
        </p>
      ) : (
        <ul className="space-y-3">
          {data.rows.map((row) => (
            <PersonCard key={row.key} row={row} today={data.today} />
          ))}
        </ul>
      )}
    </div>
  );
}

function OwedList({ label, items, today }: { label: string; items: OpsItem[]; today: string }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <ul className="mt-0.5 space-y-1">
        {items.slice(0, 4).map((item) => {
          const date = dateLabel(item.nextDate, today);
          return (
            <li key={item.id} className="flex items-baseline gap-2 text-sm">
              <Link href={item.href} className="min-w-0 flex-1 truncate hover:underline">
                {item.title}
              </Link>
              {date && (
                <span className={cn("shrink-0 text-xs", date.tone === "late" ? "text-destructive" : "text-muted-foreground")}>
                  {date.text}
                </span>
              )}
            </li>
          );
        })}
        {items.length > 4 && <li className="text-xs text-muted-foreground">+{items.length - 4} more</li>}
      </ul>
    </div>
  );
}

function PersonCard({ row, today }: { row: RelationshipRow; today: string }) {
  const touched = row.lastTouch ? timeAgo(row.lastTouch.at) : null;
  return (
    <li className="rounded-xl border bg-card px-3.5 py-3">
      <div className="flex flex-wrap items-baseline gap-x-2">
        {row.href ? (
          <Link href={row.href} className="text-sm font-semibold hover:underline">
            {row.name}
          </Link>
        ) : (
          <span className="text-sm font-semibold">{row.name}</span>
        )}
        {!row.entityId && <span className="text-[11px] italic text-muted-foreground">not in contacts</span>}
        {row.stage && <span className="text-[11px] text-muted-foreground">{row.stage}</span>}
        {row.ventures.length > 0 && (
          <span className="text-[11px] text-muted-foreground">{row.ventures.join(", ")}</span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {row.lastTouch
          ? `Last touch ${touched}${row.lastTouch.subject ? ` — ${row.lastTouch.subject}` : ""}`
          : row.entityId
            ? "No recorded touch"
            : "Named on a task only"}
        {row.followUpDue && <span className="text-amber-600 dark:text-amber-400"> · follow-up due</span>}
      </p>
      {(row.youOwe.length > 0 || row.theyOwe.length > 0) && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <OwedList label="You owe" items={row.youOwe} today={today} />
          <OwedList label="They owe" items={row.theyOwe} today={today} />
        </div>
      )}
    </li>
  );
}
