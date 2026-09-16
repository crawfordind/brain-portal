"use client";

/**
 * The Rolodex.
 *
 * Contacts come from the existing entity graph, so this list is populated by
 * notes the user has already written rather than by data entry.
 *
 * Unresolved contacts and possible duplicates get their own tab rather than
 * being mixed in. Both are "needs a decision from a human", and burying them in
 * the main list is how a CRM ends up full of junk nobody trusts.
 *
 * The open tab is readable from the URL (`?tab=unresolved`) so the dashboard
 * can link at the decision itself rather than at the page that contains it.
 * The tab remains local state after mount — switching tabs is a view change,
 * not navigation, and should not stack history entries.
 */

import { Suspense, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, Users, Building2, Mail, Phone, Boxes } from "lucide-react";
import {
  CompartmentBadges,
  MergeCandidateBadge,
  RoleBadge,
  UnresolvedBadge,
} from "@/components/crm/crm-badges";

interface ContactRow {
  entity: {
    id: string;
    canonical_name: string;
    entity_type: string;
    mention_count: number;
    last_seen_at: string;
  };
  compartments: string[];
  resolution: "confirmed" | "unresolved";
  needsReview: boolean;
  channels: { kind: string; value: string; is_primary: number }[];
  roles: { ventureId: string; ventureName: string; edgeType: string }[];
  lastInteractionAt: string | null;
}

interface VentureRow {
  entity: { id: string; canonical_name: string };
}

function CrmPageContent() {
  const searchParams = useSearchParams();
  const [search, setSearch] = useState("");
  const [venture, setVenture] = useState<string>("all");
  const [tab, setTab] = useState<"confirmed" | "unresolved">(
    searchParams.get("tab") === "unresolved" ? "unresolved" : "confirmed"
  );

  const { data: ventureData } = useQuery<{ ventures: VentureRow[] }>({
    queryKey: ["crm", "ventures"],
    queryFn: async () => {
      const res = await fetch("/api/crm/ventures");
      if (!res.ok) throw new Error("Failed to load ventures");
      return res.json();
    },
  });

  const { data, isLoading } = useQuery<{ contacts: ContactRow[] }>({
    queryKey: ["crm", "contacts", { search, venture, tab }],
    queryFn: async () => {
      const params = new URLSearchParams({ resolution: tab });
      if (search) params.set("q", search);
      if (venture !== "all") params.set("venture", venture);
      const res = await fetch(`/api/crm/contacts?${params}`);
      if (!res.ok) throw new Error("Failed to load contacts");
      return res.json();
    },
  });

  const contacts = data?.contacts ?? [];
  const ventures = ventureData?.ventures ?? [];
  const needingReview = contacts.filter((c) => c.needsReview).length;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
        <p className="text-sm text-muted-foreground">
          Built from the people and organisations already named in your notes.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search contacts"
            className="h-12 pl-9"
          />
        </div>
        <Button asChild variant="outline" className="h-12">
          <Link href="/crm/ventures">
            <Boxes className="mr-2 h-4 w-4" />
            Ventures
          </Link>
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={venture === "all" ? "default" : "outline"}
          onClick={() => setVenture("all")}
          className="h-9"
        >
          All ventures
        </Button>
        {ventures.map((v) => (
          <Button
            key={v.entity.id}
            size="sm"
            variant={venture === v.entity.id ? "default" : "outline"}
            onClick={() => setVenture(v.entity.id)}
            className="h-9"
          >
            {v.entity.canonical_name}
          </Button>
        ))}
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="confirmed">Contacts</TabsTrigger>
          <TabsTrigger value="unresolved">
            Needs review
            {needingReview > 0 && (
              <Badge variant="secondary" className="ml-2">
                {needingReview}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : contacts.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {tab === "unresolved" ? (
              <>Nothing waiting on a decision.</>
            ) : (
              <>
                No contacts yet. They appear as soon as your notes mention people
                or organisations.
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {contacts.map((contact) => (
            <li key={contact.entity.id}>
              <Link
                href={`/crm/${contact.entity.id}`}
                className="flex min-h-14 flex-col gap-2 rounded-lg border bg-card p-4 transition-colors hover:bg-accent"
              >
                <div className="flex flex-wrap items-center gap-2">
                  {contact.entity.entity_type === "person" ? (
                    <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="font-medium">
                    {contact.entity.canonical_name}
                  </span>
                  {contact.resolution === "unresolved" && <UnresolvedBadge />}
                  {contact.needsReview && <MergeCandidateBadge />}
                  <CompartmentBadges compartments={contact.compartments} />
                </div>

                {contact.roles.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {contact.roles.map((role) => (
                      <RoleBadge
                        key={`${role.ventureId}-${role.edgeType}`}
                        edgeType={role.edgeType}
                        ventureName={role.ventureName}
                      />
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  {contact.channels.slice(0, 2).map((c) => (
                    <span key={c.value} className="flex items-center gap-1">
                      {c.kind === "email" ? (
                        <Mail className="h-3 w-3" />
                      ) : c.kind === "phone" ? (
                        <Phone className="h-3 w-3" />
                      ) : null}
                      {c.value}
                    </span>
                  ))}
                  <span>{contact.entity.mention_count} mentions</span>
                  {contact.lastInteractionAt && (
                    <span>
                      Last touch {contact.lastInteractionAt.slice(0, 10)}
                    </span>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function CrmPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-5xl space-y-3 px-4 py-6">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      }
    >
      <CrmPageContent />
    </Suspense>
  );
}
