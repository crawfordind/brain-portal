"use client";

/**
 * One operational item as a short row: what it is, who holds it, when it
 * matters, and where it lives. The title opens the source task; everything
 * else is a single tap behind the menu.
 *
 * Rows stay short on a phone by dropping detail, never by shrinking type or
 * touch targets below the app's 12px / 44px floor.
 */

import Link from "next/link";
import { useState } from "react";
import { Check, ExternalLink, MoreHorizontal, Pencil, Unlock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { dateLabel, ownershipLine } from "@/lib/operations/format";
import { contactHref, projectHref, type OpsItem } from "@/lib/operations/types";
import { OpsEditDialog } from "./ops-edit-dialog";
import { useOpsActions } from "./use-ops-actions";

const TONE: Record<"late" | "soon" | "plain", string> = {
  late: "text-destructive",
  soon: "text-amber-600 dark:text-amber-400",
  plain: "text-muted-foreground",
};

export function OpsItemRow({
  item,
  today,
  showDetail = false,
}: {
  item: OpsItem;
  today: string;
  /** Show the decision's why/options and the full context line. */
  showDetail?: boolean;
}) {
  const { update } = useOpsActions();
  const [editing, setEditing] = useState(false);

  // A waited-on item without a due date is dated by when it was promised;
  // "3d overdue" would read as the user's own lateness, so it says "late".
  const fromExpected = !item.dueDate && item.ops.kind === "waiting" && !!item.ops.expected_at;
  const raw = dateLabel(item.dueDate?.slice(0, 10) ?? (fromExpected ? item.ops.expected_at! : null), today);
  const date =
    raw && fromExpected
      ? { ...raw, text: raw.tone === "late" ? raw.text.replace("overdue", "late") : `expected ${raw.text}` }
      : raw;
  const expectedLabel =
    item.ops.kind === "waiting" && item.ops.expected_at && item.dueDate
      ? dateLabel(item.ops.expected_at, today)
      : null;
  const who = ownershipLine(item);

  return (
    <li className="group flex items-start gap-2 py-2.5">
      <div className="min-w-0 flex-1">
        <Link
          href={item.href}
          className="line-clamp-2 text-sm font-medium leading-snug hover:underline"
        >
          {item.title}
        </Link>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          {date && <span className={cn("font-medium", TONE[date.tone])}>{date.text}</span>}
          {who &&
            (item.ops.counterparty_entity_id ? (
              <Link
                href={contactHref(item.ops.counterparty_entity_id)}
                className="hover:text-foreground hover:underline"
              >
                {who}
              </Link>
            ) : (
              <span>{who}</span>
            ))}
          {expectedLabel && <span>expected {expectedLabel.text}</span>}
          {item.ops.blocked && item.ops.kind !== "action" && (
            <span className="text-destructive">
              {item.ops.blocked_by === "me" ? "Blocked on you" : `Blocked by ${item.ops.blocked_by}`}
            </span>
          )}
          {item.projectSlug && item.projectName && (
            <Link href={projectHref(item.projectSlug)} className="truncate hover:text-foreground hover:underline">
              {item.projectName}
            </Link>
          )}
          {!item.projectId && <span className="italic opacity-70">No project</span>}
        </div>
        {showDetail && item.ops.kind === "decision" && (item.ops.why || item.ops.options?.length || item.ops.consequence) && (
          <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
            {item.ops.why && <p>Why: {item.ops.why}</p>}
            {item.ops.options?.length ? <p>Options: {item.ops.options.join(" · ")}</p> : null}
            {item.ops.consequence && <p>If late: {item.ops.consequence}</p>}
          </div>
        )}
      </div>

      <Button
        variant="ghost"
        size="icon"
        className="h-11 w-11 shrink-0 -my-1.5 text-muted-foreground hover:text-emerald-600"
        aria-label={`Mark "${item.title}" done`}
        disabled={update.isPending}
        onClick={() =>
          update.mutate({ id: item.id, body: { status: "completed" }, message: "Marked done" })
        }
      >
        <Check className="h-4 w-4" />
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-11 w-11 shrink-0 -my-1.5 -ml-2 text-muted-foreground"
            aria-label="More actions"
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            <Pencil className="mr-2 h-4 w-4" /> Change what this is…
          </DropdownMenuItem>
          {item.ops.blocked && (
            <DropdownMenuItem
              onSelect={() =>
                update.mutate({
                  id: item.id,
                  body: { ops: { blocked_by: null } },
                  message: "No longer blocked",
                })
              }
            >
              <Unlock className="mr-2 h-4 w-4" /> Unblock
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href={item.href}>
              <ExternalLink className="mr-2 h-4 w-4" /> Open task
            </Link>
          </DropdownMenuItem>
          {item.projectSlug && (
            <DropdownMenuItem asChild>
              <Link href={projectHref(item.projectSlug)}>
                <ExternalLink className="mr-2 h-4 w-4" /> Open project
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-muted-foreground"
            onSelect={() =>
              update.mutate({ id: item.id, body: { status: "cancelled" }, message: "Closed" })
            }
          >
            Close without doing
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <OpsEditDialog
        open={editing}
        onOpenChange={setEditing}
        item={item}
        pending={update.isPending}
        onSubmit={(values) =>
          update.mutate(
            {
              id: item.id,
              body: { ops: values.ops, dueDate: values.dueDate },
              message: "Updated",
            },
            { onSuccess: () => setEditing(false) }
          )
        }
      />
    </li>
  );
}

export function OpsItemList({
  items,
  today,
  showDetail,
  empty,
}: {
  items: OpsItem[];
  today: string;
  showDetail?: boolean;
  empty?: string;
}) {
  if (items.length === 0) {
    return empty ? <p className="py-3 text-sm text-muted-foreground">{empty}</p> : null;
  }
  return (
    <ul className="divide-y">
      {items.map((item) => (
        <OpsItemRow key={item.id} item={item} today={today} showDetail={showDetail} />
      ))}
    </ul>
  );
}
