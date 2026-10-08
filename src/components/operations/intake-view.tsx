"use client";

/**
 * Operations › Intake — raw captures, each with a proposal.
 *
 * Captured → proposed → confirmed → completed. The proposal is computed by
 * rules on every load and shown with its reasons; nothing is written until the
 * user taps Confirm (which creates a task), File (keep as reference/context)
 * or Dismiss. Each of those has Undo. A capture is never silently turned into
 * a commitment.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { dateLabel, timeAgo } from "@/lib/operations/format";
import type { IntakeItem, IntakeList } from "@/lib/operations/intake";
import { TRIAGE_KIND_LABELS, type TriageKind } from "@/lib/operations/triage";
import { useOpsActions } from "./use-ops-actions";

const KINDS: TriageKind[] = ["action", "decision", "waiting", "commitment", "reference", "context"];

export function IntakeView() {
  const { data, isLoading, error } = useQuery<IntakeList>({
    queryKey: ["operations", "intake"],
    queryFn: async () => {
      const res = await fetch("/api/operations/intake");
      if (!res.ok) throw new Error("Could not load intake");
      return res.json();
    },
    staleTime: 15_000,
  });

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold">Intake</h1>
        <p className="text-xs text-muted-foreground">
          Everything captured and not yet sorted. Suggestions come from simple rules and say why;
          nothing becomes a task or a promise until you confirm it.
        </p>
      </header>

      {isLoading ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : error || !data ? (
        <p className="text-sm text-destructive">Intake could not be loaded.</p>
      ) : data.items.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          Intake is clear. New captures from the Brain Bar, share sheet, or an assistant land here.
        </p>
      ) : (
        <>
          {data.total > data.items.length && (
            <p className="text-xs text-muted-foreground">
              Showing the newest {data.items.length} of {data.total}.
            </p>
          )}
          <ul className="space-y-3">
            {data.items.map((item) => (
              <IntakeCard key={item.id} item={item} today={data.today} projects={data.projects} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function IntakeCard({
  item,
  today,
  projects,
}: {
  item: IntakeItem;
  today: string;
  projects: IntakeList["projects"];
}) {
  const p = item.proposal;
  const { intake } = useOpsActions();
  const [kind, setKind] = useState<TriageKind>(p.kind);
  const [title, setTitle] = useState(p.title);
  const [dueDate, setDueDate] = useState(p.dueDate ?? "");
  const [projectId, setProjectId] = useState(p.projectId ?? "");
  const [counterparty, setCounterparty] = useState(p.counterparty ?? "");

  const filing = kind === "reference" || kind === "context";
  const due = dateLabel(dueDate || null, today);
  const changed = kind !== p.kind;

  const confirm = () =>
    intake.mutate({
      id: item.id,
      message: filing ? "Filed" : `Confirmed as ${TRIAGE_KIND_LABELS[kind].toLowerCase()}`,
      body: filing
        ? { action: "file", kind, projectId: projectId || null }
        : {
            action: "confirm",
            kind,
            title,
            dueDate: dueDate || null,
            projectId: projectId || null,
            counterparty: counterparty || null,
            // Keep the contact link only while the name is the proposed one.
            counterpartyEntityId: counterparty === p.counterparty ? p.counterpartyEntityId : null,
            direction: p.direction,
            options: p.options,
          },
    });

  return (
    <li className="rounded-xl border bg-card px-3.5 py-3">
      <p className="whitespace-pre-wrap break-words text-sm">{item.content}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Captured {timeAgo(item.capturedAt) ?? ""} · {item.captureType}
        {item.sourceLabel && ` · from ${item.sourceLabel}`}
      </p>

      <div className="mt-3 rounded-lg bg-muted/40 p-2.5">
        <p className="text-xs">
          <span className="font-medium">
            {p.confidence === "unclear" ? "Unclear — " : "Suggested: "}
            {TRIAGE_KIND_LABELS[p.kind]}
          </span>
          {p.reasons.length > 0 && <span className="text-muted-foreground"> · {p.reasons.join(" · ")}</span>}
        </p>

        <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label="What is this?">
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => setKind(k)}
              className={cn(
                "min-h-9 rounded-full border px-3 text-xs",
                kind === k ? "border-primary bg-primary/10 font-medium text-primary" : "bg-background hover:bg-muted"
              )}
            >
              {TRIAGE_KIND_LABELS[k]}
            </button>
          ))}
        </div>

        {!filing && (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" className="sm:col-span-2" />
            <label className="text-xs text-muted-foreground">
              Due{p.dueBasis && dueDate === p.dueDate ? ` (from "${p.dueBasis}")` : ""}
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="mt-0.5" />
            </label>
            {(kind === "waiting" || kind === "commitment") && (
              <label className="text-xs text-muted-foreground">
                {kind === "waiting" ? "Waiting on" : "With"}
                <Input
                  value={counterparty}
                  onChange={(e) => setCounterparty(e.target.value)}
                  placeholder="Not named"
                  className="mt-0.5"
                />
              </label>
            )}
          </div>
        )}

        <label className="mt-2 block text-xs text-muted-foreground">
          Project{p.projectName && projectId === p.projectId ? " (suggested)" : ""}
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="mt-0.5 h-9 w-full rounded-md border bg-background px-2 text-sm text-foreground"
          >
            <option value="">No project</option>
            {projects.map((proj) => (
              <option key={proj.id} value={proj.id}>
                {proj.ventureName ? `${proj.ventureName} › ${proj.name}` : proj.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" className="h-10" onClick={confirm} disabled={intake.isPending || (!filing && !title.trim())}>
          {filing ? "File it" : `Confirm ${TRIAGE_KIND_LABELS[kind].toLowerCase()}`}
          {!filing && due ? ` · ${due.text}` : ""}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-10 text-muted-foreground"
          disabled={intake.isPending}
          onClick={() => intake.mutate({ id: item.id, body: { action: "dismiss" }, message: "Dismissed" })}
        >
          Dismiss
        </Button>
        {changed && <span className="text-[11px] text-muted-foreground">Changed from the suggestion</span>}
      </div>
    </li>
  );
}
