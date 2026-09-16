"use client";

/**
 * Ventures overview. One card per venture with its counts, plus any
 * unassigned products, which are shown rather than hidden so nothing gets lost.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Boxes, Plus } from "lucide-react";
import { toast } from "sonner";

interface VentureSummary {
  entity: { id: string; canonical_name: string };
  productCount: number;
  projectCount: number;
  contactCount: number;
  interactionCount: number;
}

interface VenturesResponse {
  ventures: VentureSummary[];
  unassignedProducts: { id: string; canonical_name: string }[];
}

export default function VenturesPage() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");

  const { data, isLoading } = useQuery<VenturesResponse>({
    queryKey: ["crm", "ventures"],
    queryFn: async () => {
      const res = await fetch("/api/crm/ventures");
      if (!res.ok) throw new Error("Failed to load ventures");
      return res.json();
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/crm/ventures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to create");
      return json;
    },
    onSuccess: (json: { adopted: boolean }) => {
      setName("");
      queryClient.invalidateQueries({ queryKey: ["crm", "ventures"] });
      toast.success(
        json.adopted
          ? "Adopted an existing entity, keeping its history"
          : "Venture created"
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/crm">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Contacts
        </Link>
      </Button>

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Ventures</h1>
        <p className="text-sm text-muted-foreground">
          Each venture holds its own products, projects, contacts and history.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New venture name"
          className="h-12 flex-1 min-w-[200px]"
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) create.mutate();
          }}
        />
        <Button
          className="h-12"
          disabled={!name.trim() || create.isPending}
          onClick={() => create.mutate()}
        >
          <Plus className="mr-2 h-4 w-4" />
          Add venture
        </Button>
      </div>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : (data?.ventures.length ?? 0) === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No ventures yet. Add one above, or run{" "}
            <code className="rounded bg-muted px-1">npm run seed:ventures</code>{" "}
            to bootstrap the known set.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {data!.ventures.map((v) => (
            <Link
              key={v.entity.id}
              href={`/crm/ventures/${v.entity.id}`}
              className="rounded-lg border bg-card p-4 transition-colors hover:bg-accent"
            >
              <p className="font-medium">{v.entity.canonical_name}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                {v.productCount} products · {v.projectCount} projects ·{" "}
                {v.contactCount} contacts · {v.interactionCount} touches
              </p>
            </Link>
          ))}
        </div>
      )}

      {(data?.unassignedProducts.length ?? 0) > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Boxes className="h-4 w-4" />
              Unassigned products
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-sm text-muted-foreground">
              These belong to no venture yet. Open a venture to move them in.
            </p>
            <ul className="flex flex-wrap gap-2">
              {data!.unassignedProducts.map((p) => (
                <li
                  key={p.id}
                  className="rounded-md border px-3 py-2 text-sm"
                >
                  {p.canonical_name}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
