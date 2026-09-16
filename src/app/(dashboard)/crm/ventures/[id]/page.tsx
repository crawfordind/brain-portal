"use client";

/**
 * Venture detail: its products, projects and contacts, and the place where a
 * product or project is moved to another venture.
 *
 * Moving shows what stays put. A product's history does not travel with it:
 * interactions keep the venture they were logged under, so revenue and
 * compliance context stay attached to what actually happened.
 */

import { use, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Info, Plus } from "lucide-react";
import { toast } from "sonner";

interface VentureSummary {
  entity: { id: string; canonical_name: string };
  productCount: number;
  projectCount: number;
  contactCount: number;
  interactionCount: number;
}

interface Member {
  id: string;
  name: string;
  kind: "product" | "project";
}

const UNASSIGNED = "__none__";

export default function VentureDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const queryClient = useQueryClient();
  const [productName, setProductName] = useState("");

  const { data: ventureData } = useQuery<{
    ventures: VentureSummary[];
    unassignedProducts: { id: string; canonical_name: string }[];
  }>({
    queryKey: ["crm", "ventures"],
    queryFn: async () => {
      const res = await fetch("/api/crm/ventures");
      if (!res.ok) throw new Error("Failed to load ventures");
      return res.json();
    },
  });

  const { data: members, isLoading } = useQuery<{ members: Member[] }>({
    queryKey: ["crm", "venture-members", id],
    queryFn: async () => {
      const res = await fetch(`/api/crm/ventures/${id}/members`);
      if (!res.ok) throw new Error("Failed to load venture members");
      return res.json();
    },
  });

  const venture = ventureData?.ventures.find((v) => v.entity.id === id);
  const otherVentures =
    ventureData?.ventures.filter((v) => v.entity.id !== id) ?? [];
  const unassigned = ventureData?.unassignedProducts ?? [];

  const move = useMutation({
    mutationFn: async (input: {
      kind: "product" | "project";
      id: string;
      ventureId: string | null;
    }) => {
      const res = await fetch("/api/crm/structure/move", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to move");
      return json as { message: string };
    },
    onSuccess: (json) => {
      queryClient.invalidateQueries({ queryKey: ["crm"] });
      toast.success(json.message);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addProduct = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/crm/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: productName, ventureId: id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to create");
      return json;
    },
    onSuccess: () => {
      setProductName("");
      queryClient.invalidateQueries({ queryKey: ["crm"] });
      toast.success("Product added");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/crm/ventures">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Ventures
        </Link>
      </Button>

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {venture?.entity.canonical_name ?? "Venture"}
        </h1>
        {venture && (
          <p className="text-sm text-muted-foreground">
            {venture.contactCount} contacts · {venture.interactionCount} touches
          </p>
        )}
      </header>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Products and projects</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Moving something to another venture does not move its history. Past
            interactions keep the venture they were logged under.
          </p>

          {isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : (members?.members.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing assigned to this venture yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {members!.members.map((member) => (
                <li
                  key={`${member.kind}-${member.id}`}
                  className="flex min-h-14 flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
                >
                  <span className="text-sm">
                    {member.name}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {member.kind}
                    </span>
                  </span>
                  <Select
                    value={id}
                    onValueChange={(value) =>
                      move.mutate({
                        kind: member.kind,
                        id: member.id,
                        ventureId: value === UNASSIGNED ? null : value,
                      })
                    }
                  >
                    <SelectTrigger className="h-11 w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={id}>
                        {venture?.entity.canonical_name ?? "This venture"}
                      </SelectItem>
                      {otherVentures.map((v) => (
                        <SelectItem key={v.entity.id} value={v.entity.id}>
                          Move to {v.entity.canonical_name}
                        </SelectItem>
                      ))}
                      <SelectItem value={UNASSIGNED}>Unassign</SelectItem>
                    </SelectContent>
                  </Select>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Input
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              placeholder="New product name"
              className="h-11 flex-1 min-w-[180px]"
              onKeyDown={(e) => {
                if (e.key === "Enter" && productName.trim()) addProduct.mutate();
              }}
            />
            <Button
              className="h-11"
              disabled={!productName.trim() || addProduct.isPending}
              onClick={() => addProduct.mutate()}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add product
            </Button>
          </div>
        </CardContent>
      </Card>

      {unassigned.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Unassigned products</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {unassigned.map((p) => (
                <li
                  key={p.id}
                  className="flex min-h-14 flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
                >
                  <span className="text-sm">{p.canonical_name}</span>
                  <Button
                    variant="outline"
                    className="h-11"
                    onClick={() =>
                      move.mutate({ kind: "product", id: p.id, ventureId: id })
                    }
                  >
                    Move here
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Button asChild variant="outline" className="h-12 w-full">
        <Link href={`/crm?venture=${id}`}>View contacts for this venture</Link>
      </Button>
    </div>
  );
}
