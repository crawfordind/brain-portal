"use client";

/**
 * Edit a contact's full name, type and "about" text.
 *
 * Contacts are born from notes, usually as a first name. This is where the
 * user turns "Justin" into "Justin Smith". The old name is kept as an alias by
 * the server, so notes that say "Justin" keep finding him. Contact details are
 * added in the "How to reach them" card, which this dialog points to.
 */

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { entityTypeLabel } from "@/lib/crm/contact-list";

const TYPES = ["person", "org", "place", "project", "product", "input", "other"];

export interface EditableContact {
  id: string;
  canonical_name: string;
  entity_type: string;
  about: string | null;
}

class NameTakenError extends Error {
  constructor(
    message: string,
    readonly existing: { id: string; name: string }
  ) {
    super(message);
  }
}

export function EditContactDialog({
  contact,
  open,
  onOpenChange,
}: {
  contact: EditableContact;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[100dvh] overflow-y-auto sm:max-w-lg">
        {/* Remounted on every open, so the form starts from the saved values. */}
        {open && (
          <EditContactForm contact={contact} onDone={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditContactForm({
  contact,
  onDone,
}: {
  contact: EditableContact;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(contact.canonical_name);
  const [type, setType] = useState(contact.entity_type);
  const [about, setAbout] = useState(contact.about ?? "");
  const [taken, setTaken] = useState<{ id: string; name: string } | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/crm/contacts/${contact.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, type, about }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 409 && json.existing) {
        throw new NameTakenError(json.error, json.existing);
      }
      if (!res.ok) throw new Error(json.error ?? "Could not save");
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm"] });
      toast.success("Contact saved");
      onDone();
    },
    onError: (e: Error) => {
      if (e instanceof NameTakenError) {
        setTaken(e.existing);
        return;
      }
      toast.error(e.message);
    },
  });

  const renamed = name.trim() !== contact.canonical_name;

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) save.mutate();
      }}
    >
      <DialogHeader>
        <DialogTitle>Edit contact</DialogTitle>
        <DialogDescription>
          Add a full name and anything worth remembering. Email and phone go in
          &ldquo;How to reach them&rdquo; on this page.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-2">
        <Label htmlFor="contact-name">Full name</Label>
        <Input
          id="contact-name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setTaken(null);
          }}
          className="h-11"
          autoComplete="off"
          autoFocus
        />
        {renamed && !taken && (
          <p className="text-xs text-muted-foreground">
            Notes that say &ldquo;{contact.canonical_name}&rdquo; will still find
            this contact.
          </p>
        )}
        {taken && (
          <p className="text-sm text-destructive" role="alert">
            <Link href={`/crm/${taken.id}`} className="underline" onClick={onDone}>
              {taken.name}
            </Link>{" "}
            already has that name. If they are the same person, open that contact
            and combine them, or use a different name here.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="contact-type">Type</Label>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger id="contact-type" className="h-11">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {entityTypeLabel(t)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="contact-about">About</Label>
        <Textarea
          id="contact-about"
          value={about}
          onChange={(e) => setAbout(e.target.value)}
          placeholder="Who they are, how you met, what they care about"
          rows={4}
          maxLength={4000}
        />
      </div>

      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" className="h-11" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" className="h-11" disabled={!name.trim() || save.isPending}>
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </form>
  );
}
