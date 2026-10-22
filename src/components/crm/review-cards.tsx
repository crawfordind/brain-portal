"use client";

/**
 * The decisions a contact can be waiting on, with the buttons to make them.
 *
 * - `WhichOneCard`: a note said "Justin" and the user knows more than one.
 *   Ingestion held that mention instead of guessing; this asks which Justin it
 *   was. The answer is remembered for that note, so it is never asked again.
 * - `WhoIsThisCard`: an unresolved capture with no candidates; name it.
 * - `DuplicateCard`: two records that may be one person.
 *
 * Every action goes through `POST /api/crm/contacts/[id]/resolve`.
 */

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Check, UserPlus } from "lucide-react";

type ResolveBody =
  | { action: "merge"; intoId: string }
  | { action: "confirm"; name?: string }
  | { action: "same" }
  | { action: "different" };

function useResolve(contactId: string) {
  const queryClient = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: async (body: ResolveBody) => {
      const res = await fetch(`/api/crm/contacts/${contactId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Could not save that");
      return json as { entityId: string };
    },
    onSuccess: ({ entityId }) => {
      queryClient.invalidateQueries({ queryKey: ["crm"] });
      queryClient.invalidateQueries({ queryKey: ["stream"] });
      toast.success("Saved");
      // A merge deletes this record; carry on at the one that remains.
      if (entityId !== contactId) router.replace(`/crm/${entityId}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export interface Ambiguity {
  name: string;
  sourceType: string;
  sourceId: string;
  sourceTitle: string | null;
  candidates: {
    id: string;
    name: string;
    mentionCount: number;
    about: string | null;
  }[];
}

function sourceHref(sourceType: string, sourceId: string): string | null {
  if (sourceType === "note") return `/notes/${sourceId}`;
  return null;
}

/** One name input and a button that saves the record as a new contact. */
function NewContactForm({
  contactId,
  initialName,
  label,
}: {
  contactId: string;
  initialName: string;
  label: string;
}) {
  const resolve = useResolve(contactId);
  const [name, setName] = useState(initialName);

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) resolve.mutate({ action: "confirm", name: name.trim() });
      }}
    >
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Full name"
        aria-label="Full name of the new contact"
        className="h-11 min-w-[180px] flex-1"
      />
      <Button
        type="submit"
        variant="outline"
        className="h-11"
        disabled={!name.trim() || resolve.isPending}
      >
        <UserPlus className="mr-2 h-4 w-4" />
        {label}
      </Button>
    </form>
  );
}

export function WhichOneCard({
  contactId,
  ambiguity,
}: {
  contactId: string;
  ambiguity: Ambiguity;
}) {
  const resolve = useResolve(contactId);
  const href = sourceHref(ambiguity.sourceType, ambiguity.sourceId);
  const where = ambiguity.sourceTitle
    ? `“${ambiguity.sourceTitle}”`
    : `a ${ambiguity.sourceType}`;

  return (
    <Card className="border-primary/40">
      <CardContent className="space-y-4 py-4">
        <div className="space-y-1">
          <p className="font-medium">Which {ambiguity.name} did you mean?</p>
          <p className="text-sm text-muted-foreground">
            You wrote &ldquo;{ambiguity.name}&rdquo; in{" "}
            {href ? (
              <Link href={href} className="underline">
                {where}
              </Link>
            ) : (
              where
            )}
            , and you know more than one. Pick the right person and that note
            will be filed under them.
          </p>
        </div>

        {ambiguity.candidates.length > 0 && (
          <ul className="space-y-2">
            {ambiguity.candidates.map((c) => (
              <li key={c.id}>
                <Button
                  variant="outline"
                  className="h-auto min-h-11 w-full justify-start py-2 text-left"
                  disabled={resolve.isPending}
                  onClick={() => resolve.mutate({ action: "merge", intoId: c.id })}
                >
                  <Check className="mr-2 h-4 w-4 shrink-0" aria-hidden />
                  <span className="min-w-0">
                    <span className="block font-medium">{c.name}</span>
                    <span className="block truncate text-xs font-normal text-muted-foreground">
                      {c.about ?? `${c.mentionCount} mentions in your notes`}
                    </span>
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Someone else?</p>
          <NewContactForm
            contactId={contactId}
            initialName={ambiguity.name}
            label="New contact"
          />
        </div>
      </CardContent>
    </Card>
  );
}

export function WhoIsThisCard({
  contactId,
  name,
}: {
  contactId: string;
  name: string;
}) {
  return (
    <Card className="border-primary/40">
      <CardContent className="space-y-3 py-4">
        <div className="space-y-1">
          <p className="font-medium">Who is this?</p>
          <p className="text-sm text-muted-foreground">
            Captured without a confirmed identity. Give them their real name to
            add them to your contacts.
          </p>
        </div>
        <NewContactForm contactId={contactId} initialName={name} label="Confirm" />
      </CardContent>
    </Card>
  );
}

export function DuplicateCard({
  contactId,
  targetName,
  reason,
}: {
  contactId: string;
  targetName: string | null;
  reason: string;
}) {
  const resolve = useResolve(contactId);

  return (
    <Card className="border-orange-500/40">
      <CardContent className="space-y-3 py-4 text-sm">
        <div className="space-y-1">
          <p className="font-medium">
            Possibly the same as
            {targetName ? ` “${targetName}”` : " another contact"}
          </p>
          <p className="text-muted-foreground">{reason}</p>
          <p className="text-xs text-muted-foreground">
            Both records are kept until you decide. Nothing was merged.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            className="h-11"
            disabled={resolve.isPending}
            onClick={() => resolve.mutate({ action: "same" })}
          >
            Same person, combine
          </Button>
          <Button
            variant="outline"
            className="h-11"
            disabled={resolve.isPending}
            onClick={() => resolve.mutate({ action: "different" })}
          >
            Different people
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
