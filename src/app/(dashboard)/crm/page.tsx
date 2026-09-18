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
 *
 * The list itself is `ContactList`: a dense, alphabetically sectioned row list
 * rather than the stack of badge-laden cards this page used to render. See that
 * component for why.
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
import { Search, Boxes, Check } from "lucide-react";
import {
  ContactList,
  type ContactListRow,
} from "@/components/crm/contact-list";

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

  const { data, isLoading } = useQuery<{ contacts: ContactListRow[] }>({
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

      {/* One scrolling row rather than a wrapping wall: with seven ventures the
          wrapped version was three rows of chrome above the list. `aria-pressed`
          and the tick mark carry the active state, so it does not depend on the
          filled/outlined colour difference alone. */}
      <div
        role="group"
        aria-label="Filter by venture"
        className="-mx-1 flex gap-2 overflow-x-auto scrollbar-none px-1 pb-1"
      >
        <VentureChip
          label="All ventures"
          active={venture === "all"}
          onClick={() => setVenture("all")}
        />
        {ventures.map((v) => (
          <VentureChip
            key={v.entity.id}
            label={v.entity.canonical_name}
            active={venture === v.entity.id}
            onClick={() => setVenture(v.entity.id)}
          />
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
        // Placeholders the height of the real rows, so the list does not
        // collapse by two thirds the moment it loads.
        <div className="space-y-px">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
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
        <ContactList contacts={contacts} />
      )}
    </div>
  );
}

/**
 * A venture filter chip.
 *
 * 44px tall, because it is a touch target; `aria-pressed` because it is a
 * toggle, not a link; and a tick on the active one, because "filled versus
 * outlined" is a colour difference and colour may not be the only signal.
 */
function VentureChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      size="sm"
      variant={active ? "default" : "outline"}
      aria-pressed={active}
      onClick={onClick}
      className="h-11 shrink-0 rounded-full"
    >
      {active && <Check className="mr-1.5 h-4 w-4" aria-hidden />}
      {label}
    </Button>
  );
}

export default function CrmPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-5xl space-y-3 px-4 py-6">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      }
    >
      <CrmPageContent />
    </Suspense>
  );
}
