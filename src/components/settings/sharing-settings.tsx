"use client";

/**
 * Saved share recipients: names for accounts the user shares with often.
 *
 * "work" → work@example.com lets the user tell their AI assistant "share this
 * with my work account". It is also the limit on what an assistant may do:
 * MCP keys can share only with the accounts listed here, and only this
 * signed-in screen can change the list.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SavedRecipient } from "@/lib/sharing/types";

const QUERY_KEY = ["sharing-recipients"];

export function SharingSettingsPanel() {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState("");
  const [email, setEmail] = useState("");

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const res = await fetch("/api/sharing/recipients");
      if (!res.ok) throw new Error("Failed to load");
      return (await res.json()).recipients as SavedRecipient[];
    },
  });
  const recipients = data ?? [];

  const save = useMutation({
    mutationFn: async (next: SavedRecipient[]) => {
      const res = await fetch("/api/sharing/recipients", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipients: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Couldn't save");
      return body.recipients as SavedRecipient[];
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(QUERY_KEY, saved);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const add = () => {
    if (!label.trim() || !email.trim()) return;
    save.mutate([...recipients, { label: label.trim(), email: email.trim() }], {
      onSuccess: () => {
        setLabel("");
        setEmail("");
        toast.success(`Saved "${label.trim()}"`);
      },
    });
  };

  if (isLoading) return <div className="h-10 rounded-md bg-muted animate-pulse" />;
  if (isError) {
    return (
      <Button variant="outline" size="sm" onClick={() => refetch()}>
        Couldn&apos;t load. Retry
      </Button>
    );
  }

  return (
    <div className="space-y-4">
      {recipients.length > 0 ? (
        <ul className="divide-y rounded-md border">
          {recipients.map((r) => (
            <li key={r.email} className="flex items-center gap-3 p-2 pl-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{r.label}</p>
                <p className="truncate text-xs text-muted-foreground">{r.email}</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-11 w-11 shrink-0"
                aria-label={`Remove ${r.label}`}
                disabled={save.isPending}
                onClick={() => save.mutate(recipients.filter((x) => x.email !== r.email))}
              >
                <X className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          No saved accounts yet. Add one, such as your work account, and you can
          share notes with it in one tap, or by asking your AI assistant to
          &ldquo;share this with my work account&rdquo;.
        </p>
      )}

      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <Input
          placeholder="Name (e.g. work)"
          aria-label="Recipient name"
          value={label}
          maxLength={40}
          onChange={(e) => setLabel(e.target.value)}
          className="sm:w-40 h-11 sm:h-10"
        />
        <Input
          type="email"
          inputMode="email"
          placeholder="Account email"
          aria-label="Recipient email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="flex-1 h-11 sm:h-10"
        />
        <Button type="submit" disabled={save.isPending || !label.trim() || !email.trim()} className="h-11 sm:h-10">
          <Plus className="h-4 w-4 mr-1.5" />
          Add
        </Button>
      </form>

      <p className="text-xs text-muted-foreground">
        AI assistants connected with an API key can share only with the accounts
        listed here, and need the <code>notes:share</code> scope. They cannot
        change this list.
      </p>
    </div>
  );
}
