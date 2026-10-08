"use client";

/**
 * One dialog for every operational relabel and for quick-adding an item:
 * "this is a decision", "waiting on Will until Friday", "blocked by the
 * permit", "I promised Dana the samples".
 *
 * Fields appear only for the kind being set, so the form never asks a
 * question that does not apply. Nothing is required beyond the kind: an
 * unnamed counterparty is shown as "not named" rather than invented.
 */

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { OpsPatch } from "@/lib/operations/fields";
import { KIND_LABELS, OPS_KINDS, type OpsItem, type OpsKind } from "@/lib/operations/types";

export interface OpsEditValues {
  title: string;
  dueDate: string | null;
  ops: OpsPatch;
}

interface OpsEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edit this item; omit to create a new one. */
  item?: OpsItem | null;
  initialKind?: OpsKind;
  onSubmit: (values: OpsEditValues) => void;
  pending?: boolean;
}

export function OpsEditDialog(props: OpsEditDialogProps) {
  // Remount the form whenever the target changes, so fields start fresh
  // without syncing state in an effect.
  const formKey = `${props.item?.id ?? "new"}:${props.initialKind ?? ""}:${props.open}`;
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <OpsEditForm key={formKey} {...props} />
      </DialogContent>
    </Dialog>
  );
}

function OpsEditForm({ item, initialKind, onSubmit, onOpenChange, pending }: OpsEditDialogProps) {
  const ops = item?.ops;
  const [kind, setKind] = useState<OpsKind>(initialKind ?? ops?.kind ?? "action");
  const [title, setTitle] = useState(item?.title ?? "");
  const [counterparty, setCounterparty] = useState(ops?.counterparty ?? "");
  const [expectedAt, setExpectedAt] = useState(ops?.expected_at ?? "");
  const [dueDate, setDueDate] = useState(item?.dueDate?.slice(0, 10) ?? "");
  const [blockedBy, setBlockedBy] = useState(ops?.blocked_by ?? "");
  const [direction, setDirection] = useState<"i_owe" | "they_owe">(ops?.direction ?? "i_owe");
  const [why, setWhy] = useState(ops?.why ?? "");
  const [options, setOptions] = useState((ops?.options ?? []).join(", "));
  const [consequence, setConsequence] = useState(ops?.consequence ?? "");

  const isNew = !item;
  const showParty = kind === "waiting" || kind === "commitment";

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (isNew && !title.trim()) return;
    const patch: OpsPatch = {
      kind,
      state: "confirmed",
      counterparty: showParty ? counterparty.trim() || null : null,
      expected_at: kind === "waiting" ? expectedAt || null : null,
      direction: kind === "commitment" ? direction : null,
      why: kind === "decision" ? why.trim() || null : null,
      consequence: kind === "decision" ? consequence.trim() || null : null,
      options:
        kind === "decision"
          ? options
              .split(",")
              .map((o) => o.trim())
              .filter(Boolean)
          : null,
      blocked_by: blockedBy.trim() || null,
    };
    if (patch.options && patch.options.length === 0) patch.options = null;
    // Only send the counterparty link when the name changed, so an existing
    // link to a contact survives an unrelated edit.
    if (showParty && counterparty.trim() === (ops?.counterparty ?? "")) {
      delete patch.counterparty;
    }
    onSubmit({ title: title.trim(), dueDate: dueDate || null, ops: patch });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>{isNew ? "Add to operations" : "Change what this is"}</DialogTitle>
      </DialogHeader>

      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Kind">
        {OPS_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            onClick={() => setKind(k)}
            className={cn(
              "min-h-11 rounded-lg border px-3 text-sm transition-colors",
              kind === k
                ? "border-primary bg-primary/10 font-medium text-primary"
                : "hover:bg-muted"
            )}
          >
            {KIND_LABELS[k]}
          </button>
        ))}
      </div>

      {isNew && (
        <div className="space-y-1.5">
          <Label htmlFor="ops-title">What is it?</Label>
          <Input
            id="ops-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={
              kind === "decision"
                ? "Which supplier for the spring order"
                : kind === "waiting"
                  ? "Signed grant agreement"
                  : kind === "commitment"
                    ? "Send Dana the soil samples"
                    : "Call the county about the permit"
            }
            autoFocus
            required
          />
        </div>
      )}

      {showParty && (
        <div className="grid gap-3 sm:grid-cols-2">
          {kind === "commitment" && (
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Who promised?</Label>
              <div className="grid grid-cols-2 gap-2">
                {(["i_owe", "they_owe"] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDirection(d)}
                    className={cn(
                      "min-h-11 rounded-lg border px-3 text-sm",
                      direction === d ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"
                    )}
                  >
                    {d === "i_owe" ? "I did" : "They did"}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="ops-party">{kind === "waiting" ? "Waiting on" : "With"}</Label>
            <Input
              id="ops-party"
              value={counterparty}
              onChange={(e) => setCounterparty(e.target.value)}
              placeholder="Will, USDA, the shipper…"
            />
          </div>
          {kind === "waiting" && (
            <div className="space-y-1.5">
              <Label htmlFor="ops-expected">Expected by</Label>
              <Input
                id="ops-expected"
                type="date"
                value={expectedAt}
                onChange={(e) => setExpectedAt(e.target.value)}
              />
            </div>
          )}
        </div>
      )}

      {kind === "decision" && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="ops-why">Why it matters</Label>
            <Textarea id="ops-why" rows={2} value={why} onChange={(e) => setWhy(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ops-options">Options (comma separated)</Label>
            <Input id="ops-options" value={options} onChange={(e) => setOptions(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ops-consequence">If it isn&apos;t decided in time</Label>
            <Input
              id="ops-consequence"
              value={consequence}
              onChange={(e) => setConsequence(e.target.value)}
            />
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="ops-due">{kind === "decision" ? "Decide by" : "Due"}</Label>
          <Input id="ops-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ops-blocked">Blocked by (optional)</Label>
          <Input
            id="ops-blocked"
            value={blockedBy}
            onChange={(e) => setBlockedBy(e.target.value)}
            placeholder="me, the permit, Will…"
          />
        </div>
      </div>

      <DialogFooter className="gap-2">
        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {isNew ? "Add" : "Save"}
        </Button>
      </DialogFooter>
    </form>
  );
}
