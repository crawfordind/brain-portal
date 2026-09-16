"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Check, X, Clock, Mail, Users } from "lucide-react";
import { format } from "date-fns";

interface WaitlistEntry {
  id: string;
  email: string;
  source: string;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

type StatusFilter = "all" | "pending" | "approved" | "rejected";

const STATUS_BADGE: Record<string, { variant: "default" | "secondary" | "outline" | "destructive"; label: string }> = {
  pending: { variant: "secondary", label: "Pending" },
  approved: { variant: "default", label: "Approved" },
  rejected: { variant: "destructive", label: "Rejected" },
};

export default function AdminWaitlistPage() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<StatusFilter>("all");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin", "waitlist"],
    queryFn: async () => {
      const res = await fetch("/api/admin/waitlist");
      if (res.status === 403) throw new Error("Not authorized");
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json() as Promise<{ entries: WaitlistEntry[] }>;
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const res = await fetch("/api/admin/waitlist", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      if (!res.ok) throw new Error("Failed to update");
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["admin", "waitlist"] });
      toast.success(
        variables.status === "approved"
          ? "Approved — login email sent"
          : "Status updated"
      );
    },
    onError: () => toast.error("Failed to update"),
  });

  const entries = data?.entries ?? [];
  const filtered =
    filter === "all" ? entries : entries.filter((e) => e.status === filter);

  const counts = {
    all: entries.length,
    pending: entries.filter((e) => e.status === "pending").length,
    approved: entries.filter((e) => e.status === "approved").length,
    rejected: entries.filter((e) => e.status === "rejected").length,
  };

  if (isError) {
    return (
      <div className="p-3 lg:p-6">
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-6 text-center">
          <p className="text-sm text-destructive">Not authorized to view this page.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 lg:p-6 space-y-4 lg:space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl lg:text-2xl font-bold">Waitlist</h1>
          {!isLoading && (
            <Badge variant="secondary" className="ml-1">
              {counts.pending} pending
            </Badge>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {(["all", "pending", "approved", "rejected"] as StatusFilter[]).map(
          (f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                filter === f
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)} ({counts[f]})
            </button>
          )
        )}
      </div>

      {/* List */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border p-8 text-center">
          <Mail className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">
            {filter === "all" ? "No waitlist entries yet." : `No ${filter} entries.`}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((entry) => {
            const badge = STATUS_BADGE[entry.status] ?? {
              variant: "outline" as const,
              label: entry.status,
            };

            return (
              <div
                key={entry.id}
                className="flex items-center justify-between gap-3 rounded-lg border p-3 lg:p-4 hover:bg-muted/50 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium truncate">
                      {entry.email}
                    </span>
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {format(new Date(entry.created_at), "MMM d, yyyy")}
                    </span>
                    {entry.source !== "landing" && (
                      <span>via {entry.source}</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {entry.status === "pending" && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs"
                        onClick={() =>
                          updateMutation.mutate({
                            id: entry.id,
                            status: "rejected",
                          })
                        }
                        disabled={updateMutation.isPending}
                      >
                        <X className="h-3 w-3 mr-1" />
                        Reject
                      </Button>
                      <Button
                        size="sm"
                        className="h-8 text-xs"
                        onClick={() =>
                          updateMutation.mutate({
                            id: entry.id,
                            status: "approved",
                          })
                        }
                        disabled={updateMutation.isPending}
                      >
                        <Check className="h-3 w-3 mr-1" />
                        Approve
                      </Button>
                    </>
                  )}
                  {entry.status === "approved" && (
                    <span className="text-xs text-muted-foreground">
                      Email sent
                    </span>
                  )}
                  {entry.status === "rejected" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 text-xs"
                      onClick={() =>
                        updateMutation.mutate({
                          id: entry.id,
                          status: "approved",
                        })
                      }
                      disabled={updateMutation.isPending}
                    >
                      <Check className="h-3 w-3 mr-1" />
                      Approve
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
