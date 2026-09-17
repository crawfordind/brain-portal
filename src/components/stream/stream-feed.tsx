"use client";

/**
 * Stream Feed - The main consciousness timeline
 *
 * Displays all stream items in a unified, chronological feed.
 * Features:
 * - Type filter chips — only for types you actually have, four at a time
 * - Three row densities, remembered per device
 * - Time buckets with sticky headings, and a "since you were last here" line
 * - Paged loading
 * - Optimistic complete / archive / dismiss, rolled back on failure
 * - Empty states with onboarding
 *
 * The feed no longer carries its own "N awaiting review" banner. That number
 * was counted from the items this page happened to have loaded, so it
 * disagreed with the sidebar's server-side count; the dashboard's `NeedsYou`
 * row is now the single place anything announces that it is waiting.
 *
 * Paging is `useInfiniteQuery` rather than hand-rolled state. The previous
 * `fetchItems` callback closed over `offset` and `items.length`, so it was
 * rebuilt on every fetch while the "Load more" button still held the previous
 * one — two clicks in quick succession could request the same offset twice and
 * append the same rows twice. React Query owns the cursor now, which also
 * gives the mutations below a cache to write into.
 */

import { Fragment, useMemo, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { useStreamStore } from "@/lib/stores/stream-store";
import { StreamItemCard } from "./stream-item-card";
import { useAskAbout } from "@/hooks/use-ask-about";
import { useStreamDensity } from "@/hooks/use-stream-density";
import { useLastVisit } from "@/hooks/use-last-visit";
import { DensityToggle } from "./density-toggle";
import { groupStream } from "@/lib/stream/grouping";
import { cn } from "@/lib/utils";
import {
  Loader2,
  Sparkles,
  CheckSquare,
  FileText,
  Lightbulb,
  Bot,
  Bell,
  Link,
  HelpCircle,
  Brain,
  RefreshCw,
  BookOpen,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { StreamItemType } from "@/lib/stream/types";

const FILTER_CHIPS: Array<{
  type: StreamItemType;
  label: string;
  icon: typeof Brain;
}> = [
  { type: "task", label: "Tasks", icon: CheckSquare },
  { type: "thought", label: "Thoughts", icon: Lightbulb },
  { type: "journal", label: "Journal", icon: BookOpen },
  { type: "note", label: "Notes", icon: FileText },
  { type: "agent_output", label: "AI Work", icon: Bot },
  { type: "question", label: "Questions", icon: HelpCircle },
  { type: "reference", label: "Links", icon: Link },
  { type: "insight", label: "Insights", icon: Sparkles },
  { type: "reminder", label: "Reminders", icon: Bell },
];

/**
 * How many chips show before the rest fold behind a "+N" toggle.
 *
 * Nine chips is a horizontally scrolling wall above the content the user came
 * for, and most of them are usually empty. Chips for types with no items are
 * dropped entirely, the remainder are capped at this many, and an active
 * filter always stays visible so it can be switched off.
 */
const VISIBLE_CHIP_LIMIT = 4;

const PAGE_SIZE = 30;

interface StreamItem {
  id: string;
  type: StreamItemType;
  status: string;
  title: string;
  content: string;
  priority: string;
  projectId?: string | null;
  projectName?: string | null;
  projectColor?: string | null;
  tags: string[];
  dueDate?: string | null;
  delegatedTo?: string | null;
  agentTaskId?: string | null;
  agentStatus?: string | null;
  sourceType: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
}

interface StreamPage {
  items: StreamItem[];
  counts: Record<string, number>;
  hasMore: boolean;
}

interface StreamPages {
  pages: StreamPage[];
  pageParams: unknown[];
}

export function StreamFeed() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { filter, toggleTypeFilter, resetFilter, setSelectedItemId } = useStreamStore();
  const [showAllChips, setShowAllChips] = useState(false);
  const [density, setDensity] = useStreamDensity();
  const lastVisitAt = useLastVisit();
  const { askAbout } = useAskAbout();
  // Guards the row's own click handler from firing when the action was taken
  // from the row's dropdown.
  const askTriggeredRef = useRef(false);

  const types = filter.types.join(",");
  const statuses = filter.statuses.join(",");
  const searchQuery = filter.searchQuery || "";
  const projectId = filter.projectId || "";

  const queryKey = useMemo(
    () => ["stream", { types, statuses, searchQuery, projectId }] as const,
    [types, statuses, searchQuery, projectId]
  );

  const {
    data,
    isPending,
    isError,
    isFetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
  } = useInfiniteQuery<StreamPage>({
    queryKey,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(pageParam));
      if (types) params.set("types", types);
      if (statuses) params.set("statuses", statuses);
      if (searchQuery) params.set("q", searchQuery);
      if (projectId) params.set("projectId", projectId);

      const res = await fetch(`/api/stream?${params}`);
      if (!res.ok) throw new Error("Failed to load stream");
      return (await res.json()) as StreamPage;
    },
    // The API pages by offset, so the next cursor is everything loaded so far.
    getNextPageParam: (lastPage, allPages) =>
      lastPage.hasMore
        ? allPages.reduce((total, page) => total + page.items.length, 0)
        : undefined,
  });

  const items = useMemo(
    () => data?.pages.flatMap((page) => page.items) ?? [],
    [data]
  );
  // Counts are global rather than per-page, so any page carries the same set.
  const counts = data?.pages[0]?.counts ?? {};

  // Refresh when BrainBar submits new content.
  useEffect(() => {
    const handleRefresh = () => {
      queryClient.invalidateQueries({ queryKey: ["stream"] });
    };
    window.addEventListener("stream-refresh", handleRefresh);
    return () => window.removeEventListener("stream-refresh", handleRefresh);
  }, [queryClient]);

  /**
   * Apply an optimistic change to every loaded page, remembering the previous
   * cache so `onError` can put it back. Returning the snapshot as the mutation
   * context is React Query's rollback idiom.
   */
  const applyOptimistic = async (
    transform: (items: StreamItem[]) => StreamItem[]
  ) => {
    await queryClient.cancelQueries({ queryKey });
    const previous = queryClient.getQueryData<StreamPages>(queryKey);

    queryClient.setQueryData<StreamPages>(queryKey, (old) =>
      old
        ? {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              items: transform(page.items),
            })),
          }
        : old
    );

    return { previous };
  };

  const rollback = (context: { previous?: StreamPages } | undefined) => {
    if (context?.previous) {
      queryClient.setQueryData(queryKey, context.previous);
    }
  };

  /**
   * Resync once the write has settled. The optimistic patch fixes the row, but
   * the filter chips read `counts`, which is computed server-side across every
   * source table — leaving it alone would show "Tasks 9" over eight tasks.
   */
  const resync = () => {
    queryClient.invalidateQueries({ queryKey: ["stream"] });
  };

  const completeMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      });
      if (!res.ok) throw new Error("Failed to complete task");
    },
    onMutate: (id) =>
      applyOptimistic((items) =>
        items.map((item) =>
          item.id === id ? { ...item, status: "completed" } : item
        )
      ),
    onError: (_error, _id, context) => {
      rollback(context);
      toast.error("Couldn't complete that task. Try again.");
    },
    onSettled: resync,
  });

  const archiveMutation = useMutation({
    mutationFn: async (id: string) => {
      // One endpoint for every source table — the feed does not know which
      // table a row came from, and `/api/stream/[id]` resolves that server-side.
      const res = await fetch(`/api/stream/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "archived" }),
      });
      if (!res.ok) throw new Error("Failed to archive item");
    },
    onMutate: (id) =>
      applyOptimistic((items) => items.filter((item) => item.id !== id)),
    onError: (_error, _id, context) => {
      rollback(context);
      toast.error("Couldn't archive that. It's still in your stream.");
    },
    onSettled: resync,
  });

  const dismissMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/reminders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "dismissed" }),
      });
      if (!res.ok) throw new Error("Failed to dismiss reminder");
    },
    onMutate: (id) =>
      applyOptimistic((items) => items.filter((item) => item.id !== id)),
    onError: (_error, _id, context) => {
      rollback(context);
      toast.error("Couldn't dismiss that reminder. Try again.");
    },
    onSettled: resync,
  });

  const handleSelect = (id: string) => {
    // Skip navigation if "Ask about this" was just triggered
    if (askTriggeredRef.current) {
      askTriggeredRef.current = false;
      return;
    }

    const item = items.find((i) => i.id === id);
    if (!item) return;

    // Route to appropriate page based on type
    if (item.type === "journal") {
      router.push("/journal");
    } else if (item.type === "note") {
      router.push(`/notes/${id}`);
    } else if (item.type === "agent_output" && item.agentTaskId) {
      router.push(`/tasks?review=${item.agentTaskId}`);
    } else {
      setSelectedItemId(id);
    }
  };

  const handleAskAbout = (id: string) => {
    const item = items.find((i) => i.id === id);
    if (!item) return;

    // Guard against concurrent handleSelect firing (e.g. from dropdown close event propagation)
    askTriggeredRef.current = true;
    setTimeout(() => { askTriggeredRef.current = false; }, 300);

    askAbout({ id: item.id, type: item.type, title: item.title, content: item.content });
  };

  // Separate items into sections — review items now flow into the active stream
  const activeItems = useMemo(
    () => items.filter((i) => i.status !== "completed"),
    [items]
  );
  const completedItems = useMemo(
    () => items.filter((i) => i.status === "completed"),
    [items]
  );

  /*
   * Buckets are computed from a clock captured once per render pass rather than
   * per row, so every row in a batch is bucketed against the same instant — two
   * rows a second apart must not straddle the "Now" boundary because the second
   * one was evaluated a tick later.
   *
   * `items` is the dependency rather than `Date.now()`: re-bucketing on a timer
   * would reorder the list under a reader for no benefit they asked for.
   */
  const grouped = useMemo(
    () => groupStream(activeItems, { now: new Date(), lastVisitAt }),
    [activeItems, lastVisitAt]
  );

  /*
   * Where to draw the "since you were last here" line. Entries arrive
   * newest-first, so the boundary is the first entry that is *not* new — one
   * point in the whole list, resolved here rather than by mutating a flag while
   * rendering.
   */
  const dividerBeforeId = useMemo(() => {
    if (!grouped.showDivider) return null;
    for (const group of grouped.groups) {
      for (const entry of group.entries) {
        if (!entry.isNew) return entry.item.id;
      }
    }
    return null;
  }, [grouped]);

  // Chips for types the user has nothing of are pure noise, but a chip that is
  // currently switched on must stay reachable even if its count is 0.
  const relevantChips = FILTER_CHIPS.filter(
    ({ type }) => (counts[type] || 0) > 0 || filter.types.includes(type)
  );
  const visibleChips = showAllChips
    ? relevantChips
    : relevantChips.slice(0, VISIBLE_CHIP_LIMIT);
  const hiddenChipCount = relevantChips.length - visibleChips.length;
  const hasActiveFilter =
    filter.types.length > 0 ||
    filter.statuses.length > 0 ||
    !!filter.searchQuery ||
    !!filter.projectId;

  // A background refetch dims the list; fetching the *next* page must not,
  // because the rows already on screen are not being replaced.
  const isRefreshing = isFetching && !isFetchingNextPage && items.length > 0;

  // Cards float with a gap; rows read better as one ruled list.
  const isCardDensity = density === "comfortable";

  return (
    <div className="space-y-4">
      {/* Filter chips — only types you have, capped, with a clear-all escape */}
      {relevantChips.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto scrollbar-none pb-1">
          {hasActiveFilter && (
            <button
              onClick={() => resetFilter()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full border border-border bg-background text-muted-foreground hover:bg-muted whitespace-nowrap transition-all"
            >
              <X className="h-3 w-3" />
              Clear
            </button>
          )}
          {visibleChips.map(({ type, label, icon: Icon }) => {
            const isActive = filter.types.includes(type);
            const count = counts[type] || 0;
            return (
              <button
                key={type}
                onClick={() => toggleTypeFilter(type)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full border whitespace-nowrap transition-all",
                  isActive
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background hover:bg-muted border-border text-muted-foreground"
                )}
              >
                <Icon className="h-3 w-3" />
                {label}
                {count > 0 && (
                  <span
                    className={cn(
                      "text-[10px] font-medium",
                      isActive ? "text-primary-foreground/80" : "text-muted-foreground"
                    )}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
          {(hiddenChipCount > 0 || showAllChips) && (
            <button
              onClick={() => setShowAllChips(!showAllChips)}
              className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-full border border-dashed border-border bg-background text-muted-foreground hover:bg-muted whitespace-nowrap transition-all"
              aria-expanded={showAllChips}
            >
              {showAllChips ? "Fewer" : `+${hiddenChipCount}`}
            </button>
          )}

          {/* Pushed to the far end: it filters nothing, it shapes the list. */}
          <div className="ml-auto pl-2">
            <DensityToggle density={density} onChange={setDensity} />
          </div>
        </div>
      )}

      {/* Active items, in time buckets — review items show inline with badges */}
      {grouped.groups.length > 0 && (
        <div
          className={cn(
            "transition-opacity duration-200",
            isRefreshing && "opacity-60 pointer-events-none"
          )}
        >
          {grouped.groups.map((group) => (
            <section key={group.key} aria-label={group.label}>
              {/* Sticky inside the scroll container, so the heading answers
                  "when is this?" for whatever row is currently under it. */}
              <h2 className="sticky top-0 z-10 -mx-1 bg-background/95 px-1 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur">
                {group.label}
              </h2>

              <div className={isCardDensity ? "space-y-2 py-1" : "divide-y"}>
                {group.entries.map(({ item, isNew }) => (
                  <Fragment key={item.id}>
                    {item.id === dividerBeforeId && (
                      <div
                        className="flex items-center gap-2 py-2 text-[11px] font-medium text-primary"
                        role="separator"
                      >
                        <span className="h-px flex-1 bg-primary/30" />
                        <span className="whitespace-nowrap">
                          {grouped.newCount} new since you were last here
                        </span>
                        <span className="h-px flex-1 bg-primary/30" />
                      </div>
                    )}
                    <StreamItemCard
                      item={item}
                      density={density}
                      isNew={isNew}
                      onSelect={handleSelect}
                      onComplete={(id) => completeMutation.mutate(id)}
                      onAskAbout={handleAskAbout}
                      onArchive={(id) => archiveMutation.mutate(id)}
                      onDismiss={(id) => dismissMutation.mutate(id)}
                    />
                  </Fragment>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Completed items (collapsed) */}
      {completedItems.length > 0 && (
        <details className="group">
          <summary className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer hover:text-foreground transition-colors">
            <CheckSquare className="h-3.5 w-3.5" />
            {completedItems.length} completed
          </summary>
          <div className={cn("mt-2", isCardDensity ? "space-y-2" : "divide-y")}>
            {completedItems.map((item) => (
              <StreamItemCard
                key={item.id}
                item={item}
                density={density}
                onSelect={handleSelect}
                onAskAbout={handleAskAbout}
                onArchive={(id) => archiveMutation.mutate(id)}
              />
            ))}
          </div>
        </details>
      )}

      {/* Load more */}
      {hasNextPage && items.length > 0 && (
        <div className="flex justify-center py-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Load more
          </Button>
        </div>
      )}

      {/* Error state */}
      {isError && items.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/10 mb-3">
            <RefreshCw className="h-5 w-5 text-destructive" />
          </div>
          <h3 className="text-sm font-medium mb-1">Couldn&apos;t load your stream</h3>
          <p className="text-xs text-muted-foreground mb-3">
            Something went wrong. Check your connection and try again.
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Try again
          </Button>
        </div>
      )}

      {/* Empty state */}
      {!isPending && !isError && items.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 mb-4">
            <Brain className="h-8 w-8 text-primary" />
          </div>
          {hasActiveFilter ? (
            <>
              <h3 className="text-lg font-semibold mb-1">No matching items</h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                Nothing matches your current filters. Try broadening your search or removing some filters.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => resetFilter()}
              >
                Clear filters
              </Button>
            </>
          ) : (
            <>
              <h3 className="text-lg font-semibold mb-1">Your mind is clear</h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                Start typing in the Brain Bar above. Every thought, task, question,
                or idea flows into your stream automatically organized.
              </p>
              <div className="flex flex-wrap gap-2 mt-4 justify-center">
                <Badge variant="outline" className="text-xs">
                  <Lightbulb className="h-3 w-3 mr-1" />
                  &quot;I should look into...&quot;
                </Badge>
                <Badge variant="outline" className="text-xs">
                  <CheckSquare className="h-3 w-3 mr-1" />
                  &quot;Need to send the report&quot;
                </Badge>
                <Badge variant="outline" className="text-xs">
                  <Bot className="h-3 w-3 mr-1" />
                  &quot;Write a blog post about AI&quot;
                </Badge>
              </div>
            </>
          )}
        </div>
      )}

      {/* Loading state */}
      {isPending && (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-[72px] rounded-xl bg-accent animate-pulse" />
          ))}
        </div>
      )}

    </div>
  );
}
