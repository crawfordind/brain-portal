"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Copy, Globe, Link2, RefreshCw, UserPlus, Users, X } from "lucide-react";
import type { NoteShare } from "@/lib/sharing/store";
import type { NoteSharePermission, SavedRecipient } from "@/lib/sharing/types";

interface ShareDialogProps {
  noteId: string;
  slug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface SharesResponse {
  shares: NoteShare[];
  recipients: SavedRecipient[];
  publicLink: { url: string; sharedAt: string | null } | null;
  accountSharingReady: boolean;
}

async function send<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Something went wrong");
  return body as T;
}

/**
 * Two ways to share a note, kept visibly apart because they are not the same
 * thing: "People" gives another account access to the live note inside the
 * app; "Public link" shows a read-only page to anyone holding the URL.
 */
export function ShareDialog({ noteId, slug, open, onOpenChange }: ShareDialogProps) {
  const queryClient = useQueryClient();
  const queryKey = ["note-shares", noteId];
  const [email, setEmail] = useState("");
  const [permission, setPermission] = useState<NoteSharePermission>("view");

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey,
    queryFn: () => send<SharesResponse>(`/api/notes/${noteId}/shares`, { method: "GET" }),
    enabled: open,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey });
    queryClient.invalidateQueries({ queryKey: ["note", slug] });
  };

  const addShare = useMutation({
    mutationFn: (input: { email: string; permission: NoteSharePermission }) =>
      send<{ share: NoteShare; created: boolean }>(`/api/notes/${noteId}/shares`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: ({ share, created }) => {
      setEmail("");
      refresh();
      const who = share.recipient_name || share.recipient_email;
      if (!share.recipient_has_account) {
        toast.success(`Shared with ${who}`, {
          description: "No account uses that address yet. It will appear for them once one does.",
        });
      } else {
        toast.success(created ? `Shared with ${who}` : `Updated access for ${who}`);
      }
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const changePermission = useMutation({
    mutationFn: (input: { shareId: string; permission: NoteSharePermission }) =>
      send(`/api/notes/${noteId}/shares/${input.shareId}`, {
        method: "PATCH",
        body: JSON.stringify({ permission: input.permission }),
      }),
    onSuccess: refresh,
    onError: (error: Error) => toast.error(error.message),
  });

  const removeShare = useMutation({
    mutationFn: (share: NoteShare) =>
      send(`/api/notes/${noteId}/shares/${share.id}`, { method: "DELETE" }),
    onSuccess: (_data, share) => {
      refresh();
      toast.success(`Stopped sharing with ${share.recipient_name || share.recipient_email}`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const publicLink = useMutation({
    mutationFn: (method: "POST" | "PUT" | "DELETE") =>
      send<{ shareUrl?: string }>(`/api/notes/${noteId}/share`, { method }),
    onSuccess: (_data, method) => {
      refresh();
      toast.success(
        method === "POST" ? "Public link created" : method === "PUT" ? "New link created; the old one no longer works" : "Public link turned off"
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy the link");
    }
  };

  const shares = data?.shares ?? [];
  const recipients = data?.recipients ?? [];
  const sharedEmails = new Set(shares.map((s) => s.recipient_email));
  const quickPicks = recipients.filter((r) => !sharedEmails.has(r.email));
  const busy = addShare.isPending;

  const submit = (target: string) => {
    if (!target.trim()) return;
    addShare.mutate({ email: target.trim(), permission });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Share note</DialogTitle>
          <DialogDescription>
            Give another account access, or make a public read-only link.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-2" aria-busy="true">
            <div className="h-10 rounded-md bg-muted animate-pulse" />
            <div className="h-10 rounded-md bg-muted animate-pulse" />
          </div>
        ) : isError ? (
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">Couldn&apos;t load sharing settings.</span>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Retry
            </Button>
          </div>
        ) : (
          <div className="space-y-5">
            {/* ── People ─────────────────────────────── */}
            <section className="space-y-3" aria-labelledby="share-people-heading">
              <h3 id="share-people-heading" className="flex items-center gap-2 text-sm font-medium">
                <Users className="h-4 w-4" />
                People
              </h3>

              {data?.accountSharingReady === false ? (
                <p className="text-sm text-muted-foreground">
                  Sharing with accounts needs a database update on this server
                  (<code>npm run db:migrate</code>).
                </p>
              ) : (
                <>
                  <form
                    className="flex flex-col gap-2 sm:flex-row"
                    onSubmit={(e) => {
                      e.preventDefault();
                      submit(email);
                    }}
                  >
                    <Input
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      placeholder="Account email"
                      aria-label="Email of the account to share with"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="flex-1 h-11 sm:h-10"
                    />
                    <div className="flex gap-2">
                      <Select
                        value={permission}
                        onValueChange={(v) => setPermission(v as NoteSharePermission)}
                      >
                        <SelectTrigger className="w-[110px] h-11 sm:h-10" aria-label="Permission">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="view">Can view</SelectItem>
                          <SelectItem value="edit">Can edit</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button type="submit" disabled={busy || !email.trim()} className="h-11 sm:h-10">
                        <UserPlus className="h-4 w-4 sm:mr-2" />
                        <span className="hidden sm:inline">Share</span>
                      </Button>
                    </div>
                  </form>

                  {quickPicks.length > 0 && (
                    <div className="flex flex-wrap gap-2" aria-label="Saved recipients">
                      {quickPicks.map((r) => (
                        <Button
                          key={r.email}
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={busy}
                          onClick={() => submit(r.email)}
                          title={r.email}
                          className="h-9"
                        >
                          <UserPlus className="h-3.5 w-3.5 mr-1.5" />
                          {r.label}
                        </Button>
                      ))}
                    </div>
                  )}

                  {shares.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Not shared with any account.
                      {recipients.length === 0 && (
                        <>
                          {" "}
                          Save accounts you share with often (like your work account) in{" "}
                          <a href="/settings#sharing" className="underline underline-offset-2">
                            Settings → Sharing
                          </a>
                          ; your AI assistant can then share with them by name.
                        </>
                      )}
                    </p>
                  ) : (
                    <ul className="divide-y rounded-md border">
                      {shares.map((share) => {
                        const label = recipients.find((r) => r.email === share.recipient_email)?.label;
                        return (
                          <li key={share.id} className="flex items-center gap-2 p-2 pl-3">
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">
                                {label || share.recipient_name || share.recipient_email}
                              </p>
                              <p className="truncate text-xs text-muted-foreground">
                                {share.recipient_email}
                                {!share.recipient_has_account && " · no account yet"}
                                {share.created_via === "mcp" && ` · shared by ${share.source_label || "an AI key"}`}
                              </p>
                            </div>
                            <Select
                              value={share.permission}
                              onValueChange={(v) =>
                                changePermission.mutate({
                                  shareId: share.id,
                                  permission: v as NoteSharePermission,
                                })
                              }
                            >
                              <SelectTrigger
                                className="w-[110px] h-10"
                                aria-label={`Permission for ${share.recipient_email}`}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="view">Can view</SelectItem>
                                <SelectItem value="edit">Can edit</SelectItem>
                              </SelectContent>
                            </Select>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-11 w-11 shrink-0"
                              aria-label={`Stop sharing with ${share.recipient_email}`}
                              disabled={removeShare.isPending}
                              onClick={() => removeShare.mutate(share)}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </>
              )}
            </section>

            <Separator />

            {/* ── Public link ────────────────────────── */}
            <section className="space-y-3" aria-labelledby="share-link-heading">
              <div className="flex items-center justify-between gap-2">
                <h3 id="share-link-heading" className="flex items-center gap-2 text-sm font-medium">
                  <Globe className="h-4 w-4" />
                  Public link
                </h3>
                {data?.publicLink && <Badge variant="secondary">On</Badge>}
              </div>

              {!data?.publicLink ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    Anyone with the link can read this note. No sign-in needed.
                  </p>
                  <Button
                    variant="outline"
                    className="w-full"
                    disabled={publicLink.isPending}
                    onClick={() => publicLink.mutate("POST")}
                  >
                    <Link2 className="h-4 w-4 mr-2" />
                    Create public link
                  </Button>
                </>
              ) : (
                <>
                  <div className="flex gap-2">
                    <Input
                      value={data.publicLink.url}
                      readOnly
                      aria-label="Public link"
                      className="font-mono text-xs"
                      onClick={(e) => e.currentTarget.select()}
                    />
                    <Button
                      variant="secondary"
                      size="icon"
                      className="h-10 w-10 shrink-0"
                      aria-label="Copy public link"
                      onClick={() => copy(data.publicLink!.url)}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      className="flex-1"
                      disabled={publicLink.isPending}
                      onClick={() => publicLink.mutate("PUT")}
                    >
                      <RefreshCw className="h-4 w-4 mr-2" />
                      New link
                    </Button>
                    <Button
                      variant="destructive"
                      className="flex-1"
                      disabled={publicLink.isPending}
                      onClick={() => publicLink.mutate("DELETE")}
                    >
                      <X className="h-4 w-4 mr-2" />
                      Turn off
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    A new link stops the old one working. Highlights and their comments are never shown on the public page.
                  </p>
                </>
              )}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
