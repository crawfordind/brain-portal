"use client";

/**
 * "Not a contact": something the note reader took for a person or org that
 * isn't one becomes a tag on the notes that mention it.
 *
 * - `NotContactDialog` asks for the tag name (its own name by default) and
 *   files it. The toast offers Undo, and the row stays restorable from the
 *   Contacts → Not contacts tab.
 * - `NotContactBanner` is what its page shows afterwards, with Restore.
 *
 * Server side: `POST/DELETE /api/crm/contacts/[id]/not-contact`
 * (`src/lib/crm/not-contact.ts`).
 */

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Tag, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const MAX_TAG_LENGTH = 60;

function useRestore(contactId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/crm/contacts/${contactId}/not-contact`, {
        method: "DELETE",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Could not restore it");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm"] });
      toast.success("Back in your contacts");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function NotContactDialog({
  contact,
  open,
  onOpenChange,
}: {
  contact: { id: string; name: string; mentionCount: number };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[100dvh] overflow-y-auto sm:max-w-md">
        {/* Remounted on every open, so the tag starts as the contact's name. */}
        {open && <NotContactForm contact={contact} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function NotContactForm({
  contact,
  onDone,
}: {
  contact: { id: string; name: string; mentionCount: number };
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const restore = useRestore(contact.id);
  const [tag, setTag] = useState(contact.name);
  const trimmed = tag.trim();

  const file = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/crm/contacts/${contact.id}/not-contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag: trimmed }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Could not file it as a tag");
      return json as { tag: string; tagged: number };
    },
    onSuccess: ({ tag: saved, tagged }) => {
      queryClient.invalidateQueries({ queryKey: ["crm"] });
      onDone();
      toast.success(`Filed as the tag “${saved}”`, {
        description:
          tagged > 0
            ? `${tagged} ${tagged === 1 ? "note was" : "notes were"} tagged.`
            : undefined,
        action: { label: "Undo", onClick: () => restore.mutate() },
      });
      router.push("/crm");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (trimmed) file.mutate();
      }}
      className="space-y-4"
    >
      <DialogHeader>
        <DialogTitle>Not a contact?</DialogTitle>
        <DialogDescription>
          &ldquo;{contact.name}&rdquo; leaves your contacts and becomes a tag
          instead. The {contact.mentionCount === 1 ? "note" : "notes"} that
          mention it get the tag, and so will new ones, without adding it back
          as a contact.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-2">
        <Label htmlFor="not-contact-tag">Tag</Label>
        <Input
          id="not-contact-tag"
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          maxLength={MAX_TAG_LENGTH}
          className="h-11"
          autoFocus
        />
      </div>

      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" className="h-11" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" className="h-11" disabled={!trimmed || file.isPending}>
          <Tag className="mr-2 h-4 w-4" />
          Make it a tag
        </Button>
      </DialogFooter>
    </form>
  );
}

export function NotContactBanner({
  contactId,
  tag,
}: {
  contactId: string;
  tag: string;
}) {
  const restore = useRestore(contactId);
  return (
    <Card className="border-muted-foreground/30">
      <CardContent className="flex flex-wrap items-center gap-3 py-4 text-sm">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-medium">Not a contact</p>
          <p className="text-muted-foreground">
            Filed as the tag &ldquo;{tag}&rdquo;. Notes that mention it are
            tagged instead of adding it to your contacts.
          </p>
        </div>
        <Button
          variant="outline"
          className="h-11"
          disabled={restore.isPending}
          onClick={() => restore.mutate()}
        >
          <UserPlus className="mr-2 h-4 w-4" />
          Restore as a contact
        </Button>
      </CardContent>
    </Card>
  );
}
