"use client";

/**
 * The contact brief: everything worth knowing before a call.
 *
 * The timeline merges note mentions with actual touches, because "what I wrote
 * about them" and "what passed between us" are one story and splitting them
 * makes the sequence unreadable.
 */

import { use, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  ArrowDownLeft,
  ArrowUpRight,
  FileText,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  CompartmentBadges,
  MergeCandidateBadge,
  RoleBadge,
  UnresolvedBadge,
} from "@/components/crm/crm-badges";

interface Brief {
  entity: {
    id: string;
    canonical_name: string;
    entity_type: string;
    mention_count: number;
  };
  compartments: string[];
  resolution: "confirmed" | "unresolved";
  mergeCandidate: { targetName: string | null; reason: string } | null;
  channels: {
    id: string;
    kind: string;
    value: string;
    label: string | null;
    is_primary: number;
    verified: number;
  }[];
  roles: { venture_id: string; venture_name: string; edge_type: string }[];
  timeline: (
    | {
        kind: "interaction";
        at: string;
        id: string;
        direction: string;
        channel: string;
        subject: string | null;
        body: string | null;
        ventureName: string | null;
      }
    | {
        kind: "mention";
        at: string;
        id: string;
        sourceType: string;
        sourceId: string;
        snippet: string | null;
      }
  )[];
  counts: { interactions: number; mentions: number };
}

export default function ContactBriefPage({
  params,
}: {
  params: Promise<{ entityId: string }>;
}) {
  const { entityId } = use(params);
  const queryClient = useQueryClient();
  const [channelKind, setChannelKind] = useState("email");
  const [channelValue, setChannelValue] = useState("");

  const { data, isLoading } = useQuery<Brief>({
    queryKey: ["crm", "contact", entityId],
    queryFn: async () => {
      const res = await fetch(`/api/crm/contacts/${entityId}`);
      if (!res.ok) throw new Error("Failed to load contact");
      return res.json();
    },
  });

  const addChannel = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/crm/contacts/${entityId}/channels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: channelKind, value: channelValue }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to add");
      return json;
    },
    onSuccess: () => {
      setChannelValue("");
      queryClient.invalidateQueries({ queryKey: ["crm", "contact", entityId] });
      toast.success("Channel added");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeChannel = useMutation({
    mutationFn: async (channelId: string) => {
      const res = await fetch(
        `/api/crm/contacts/${entityId}/channels?channelId=${channelId}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("Failed to remove");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm", "contact", entityId] });
      toast.success("Channel removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-6">
        <p className="text-sm text-muted-foreground">Contact not found.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/crm">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Contacts
        </Link>
      </Button>

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            {data.entity.canonical_name}
          </h1>
          {data.resolution === "unresolved" && <UnresolvedBadge />}
          {data.mergeCandidate && <MergeCandidateBadge />}
          <CompartmentBadges compartments={data.compartments} />
        </div>
        <p className="text-sm text-muted-foreground">
          {data.entity.entity_type} · {data.counts.interactions} touches ·{" "}
          {data.counts.mentions} mentions in your notes
        </p>
        {data.roles.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {data.roles.map((r) => (
              <RoleBadge
                key={`${r.venture_id}-${r.edge_type}`}
                edgeType={r.edge_type}
                ventureName={r.venture_name}
              />
            ))}
          </div>
        )}
      </header>

      {data.mergeCandidate && (
        <Card className="border-orange-500/40">
          <CardContent className="space-y-1 py-4 text-sm">
            <p className="font-medium">
              Possibly the same as
              {data.mergeCandidate.targetName
                ? ` "${data.mergeCandidate.targetName}"`
                : " another contact"}
            </p>
            <p className="text-muted-foreground">{data.mergeCandidate.reason}</p>
            <p className="text-xs text-muted-foreground">
              Both records are kept until you decide. Nothing was merged.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">How to reach them</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {data.channels.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No channels yet.
            </p>
          ) : (
            <ul className="space-y-1">
              {data.channels.map((c) => (
                <li
                  key={c.id}
                  className="flex min-h-11 items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="font-normal">
                      {c.kind}
                    </Badge>
                    <span>{c.value}</span>
                    {c.verified === 1 && (
                      <Badge variant="secondary" className="font-normal">
                        verified
                      </Badge>
                    )}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Remove ${c.value}`}
                    onClick={() => removeChannel.mutate(c.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Select value={channelKind} onValueChange={setChannelKind}>
              <SelectTrigger className="h-11 w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["email", "phone", "handle", "url", "address"].map((k) => (
                  <SelectItem key={k} value={k}>
                    {k}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={channelValue}
              onChange={(e) => setChannelValue(e.target.value)}
              placeholder="dana@northwindfarms.com"
              className="h-11 flex-1 min-w-[180px]"
              onKeyDown={(e) => {
                if (e.key === "Enter" && channelValue.trim()) {
                  addChannel.mutate();
                }
              }}
            />
            <Button
              className="h-11"
              disabled={!channelValue.trim() || addChannel.isPending}
              onClick={() => addChannel.mutate()}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          {data.timeline.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing recorded yet.
            </p>
          ) : (
            <ol className="space-y-3">
              {data.timeline.map((item) => (
                <li key={`${item.kind}-${item.id}`} className="flex gap-3 text-sm">
                  <span className="mt-0.5 shrink-0 text-muted-foreground">
                    {item.kind === "interaction" ? (
                      item.direction === "out" ? (
                        <ArrowUpRight className="h-4 w-4" />
                      ) : (
                        <ArrowDownLeft className="h-4 w-4" />
                      )
                    ) : (
                      <FileText className="h-4 w-4" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="font-medium">
                        {item.kind === "interaction"
                          ? (item.subject ?? item.channel)
                          : `Mentioned in a ${item.sourceType}`}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {item.at.slice(0, 10)}
                      </span>
                      {item.kind === "interaction" && item.ventureName && (
                        <Badge variant="outline" className="font-normal">
                          {item.ventureName}
                        </Badge>
                      )}
                    </div>
                    {item.kind === "interaction" && item.body && (
                      <p className="text-muted-foreground">{item.body}</p>
                    )}
                    {item.kind === "mention" && item.snippet && (
                      <p className="text-muted-foreground">{item.snippet}</p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
