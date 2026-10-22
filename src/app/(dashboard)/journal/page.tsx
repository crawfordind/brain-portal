"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  BookOpen,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Plus,
  Send,
  Sparkles,
  BarChart3,
} from "lucide-react";
import { format, addDays, subDays } from "date-fns";
import { useJournalOutbox } from "@/hooks/use-journal-outbox";
import { isValidJournalDate, MAX_ENTRY_CHARS } from "@/lib/journal/entry";
import {
  readDraft,
  remove as removeFromOutbox,
  writeDraft,
  type OutboxEntry,
} from "@/lib/journal/outbox";
import { parseDbTimestamp } from "@/lib/stream/grouping";

interface JournalEntry {
  id: string;
  note_id: string;
  date: string;
  entry_text: string;
  category: string;
  tags: string[];
  mood: string | null;
  location: string | null;
  created_at: string;
  note_title?: string;
}

interface MonthlyData {
  monthlyJournal: {
    note_id: string;
    summary: string | null;
    highlights: string[];
    categories: Record<string, number>;
    entry_count: number;
    compiled_at: string | null;
    note_content: string;
  } | null;
  entries: JournalEntry[];
  categoryBreakdown: Array<{ category: string; count: number }>;
  availableMonths: Array<{ year: number; month: number; count: number }>;
  monthName: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  general: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  personal: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  work: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
  health: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  travel: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  purchase: "bg-pink-100 text-pink-700 dark:bg-pink-900 dark:text-pink-300",
  project: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300",
  learning: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300",
  social: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
  maintenance: "bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300",
};

export default function JournalPageWrapper() {
  return (
    <Suspense fallback={
      <div className="mx-auto max-w-3xl px-4 py-6 sm:py-8 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Skeleton className="h-6 w-6 rounded" />
            <Skeleton className="h-7 w-24" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-9 w-20 rounded-md" />
            <Skeleton className="h-9 w-24 rounded-md" />
          </div>
        </div>
        <Skeleton className="h-14 rounded-lg" />
        <Skeleton className="h-24 rounded-lg" />
        <div className="space-y-3">
          <Skeleton className="h-20 rounded-lg" />
          <Skeleton className="h-20 rounded-lg" />
          <Skeleton className="h-20 rounded-lg" />
        </div>
      </div>
    }>
      <JournalPage />
    </Suspense>
  );
}

function JournalPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const dateParam = searchParams.get("date");
  const viewParam = searchParams.get("view") || "daily";
  const yearParam = searchParams.get("year");
  const monthParam = searchParams.get("month");
  const entryParam = searchParams.get("entry");
  const isNew = searchParams.get("new") === "true";

  // The URL is the one source of truth for the day, so Back/Forward and links
  // always show the page they name. An invalid date falls back to today.
  const today = format(new Date(), "yyyy-MM-dd");
  const currentDate = isValidJournalDate(dateParam) ? dateParam : today;

  const [view, setView] = useState<"daily" | "monthly">(
    viewParam === "monthly" ? "monthly" : "daily"
  );
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const m = parseInt(monthParam || "");
    return m >= 1 && m <= 12 ? m : new Date().getMonth() + 1;
  });
  const [selectedYear, setSelectedYear] = useState(() => {
    const y = parseInt(yearParam || "");
    return y >= 2000 && y <= 2100 ? y : new Date().getFullYear();
  });

  const { outbox, submit, retry } = useJournalOutbox();

  // "?entry=" comes from the command palette and voice. Queue it exactly once
  // (Strict Mode runs effects twice; a refresh would otherwise re-submit it),
  // then drop it from the URL. searchParams is already decoded: decoding it
  // again threw on any entry containing "%".
  const handledEntry = useRef<string | null>(null);
  useEffect(() => {
    if (!entryParam || handledEntry.current === entryParam) return;
    handledEntry.current = entryParam;
    submit(entryParam, currentDate);
    router.replace(`/journal?date=${currentDate}`, { scroll: false });
  }, [entryParam, currentDate, submit, router]);

  // Fetch monthly journal data
  const { data: monthlyData, isLoading: monthlyLoading } = useQuery({
    queryKey: ["journal", "monthly", selectedYear, selectedMonth],
    queryFn: async () => {
      const res = await fetch(
        `/api/journal/monthly?year=${selectedYear}&month=${selectedMonth}`
      );
      if (!res.ok) throw new Error("Failed to fetch monthly journal");
      return res.json() as Promise<MonthlyData>;
    },
    enabled: view === "monthly",
  });

  const queryClient = useQueryClient();

  // Compile monthly journal
  const compileMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/journal/monthly", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year: selectedYear,
          month: selectedMonth,
          useAI: true,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to compile monthly journal");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["journal", "monthly"] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to compile monthly journal. Please try again.");
    },
  });

  const goToDate = (date: string) => {
    setView("daily");
    router.push(`/journal?date=${date}`, { scroll: false });
  };

  const navigateDay = (direction: "prev" | "next") => {
    const d = new Date(currentDate + "T12:00:00");
    const newDate = direction === "prev" ? subDays(d, 1) : addDays(d, 1);
    goToDate(format(newDate, "yyyy-MM-dd"));
  };

  const navigateMonth = (direction: "prev" | "next") => {
    let m = selectedMonth;
    let y = selectedYear;
    if (direction === "prev") {
      m--;
      if (m < 1) { m = 12; y--; }
    } else {
      m++;
      if (m > 12) { m = 1; y++; }
    }
    setSelectedMonth(m);
    setSelectedYear(y);
  };

  const dateDisplay = format(new Date(currentDate + "T12:00:00"), "EEEE, MMMM d, yyyy");
  const isToday = currentDate === today;
  const waitingElsewhere = outbox.filter((e) => e.date !== currentDate).length;

  const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
      {/* Header — app chrome, deliberately off the paper */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BookOpen className="h-6 w-6 text-teal-600 dark:text-teal-400" />
          <h1 className="text-2xl font-bold tracking-tight">Journal</h1>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant={view === "daily" ? "default" : "outline"}
            size="sm"
            onClick={() => setView("daily")}
          >
            <Calendar className="mr-1.5 h-4 w-4" />
            Daily
          </Button>
          <Button
            variant={view === "monthly" ? "default" : "outline"}
            size="sm"
            onClick={() => setView("monthly")}
          >
            <BarChart3 className="mr-1.5 h-4 w-4" />
            Monthly
          </Button>
        </div>
      </div>

      {/* Daily View — one sheet of the same notebook the editor writes on */}
      {view === "daily" && (
        <div className="bp-notebook lg:border lg:rounded-lg">
          {/* Date navigation reads as the board at the top of the pad, matching
              the editor's toolbar rather than being a separate card. */}
          <div className="bp-notebook-toolbar sticky top-0 z-30 flex items-center justify-between gap-2 border-b px-2 py-1.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              onClick={() => navigateDay("prev")}
              aria-label="Previous day"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>

            <div className="min-w-0 text-center">
              <p className="truncate text-sm font-medium">{dateDisplay}</p>
              {isToday && (
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Today
                </p>
              )}
            </div>

            <div className="flex items-center gap-1">
              {!isToday && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 px-2 text-xs"
                  onClick={() => goToDate(format(new Date(), "yyyy-MM-dd"))}
                >
                  Today
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9"
                onClick={() => navigateDay("next")}
                aria-label="Next day"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Keyed by day: each day has its own draft, restored on return. */}
          <DailyPage
            key={currentDate}
            date={currentDate}
            isToday={isToday}
            autoFocus={isNew}
            outbox={outbox}
            waitingElsewhere={waitingElsewhere}
            onSubmit={submit}
            onRetry={retry}
          />
        </div>
      )}

      {/* Monthly View */}
      {view === "monthly" && (
        <>
          {/* Month Navigation */}
          <div className="mb-6 flex items-center justify-between rounded-lg border bg-card p-3">
            <Button variant="ghost" size="sm" onClick={() => navigateMonth("prev")}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <p className="font-semibold">
              {MONTH_NAMES[selectedMonth - 1]} {selectedYear}
            </p>
            <Button variant="ghost" size="sm" onClick={() => navigateMonth("next")}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {monthlyLoading ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-20 rounded-lg" />
                ))}
              </div>
              <Skeleton className="h-24 rounded-lg" />
              <div className="space-y-3">
                <Skeleton className="h-16 rounded-lg" />
                <Skeleton className="h-16 rounded-lg" />
              </div>
            </div>
          ) : (
            <>
              {/* Monthly Stats */}
              {monthlyData && monthlyData.entries.length > 0 && (
                <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-lg border bg-card p-3 text-center">
                    <p className="text-2xl font-bold text-teal-600">
                      {monthlyData.entries.length}
                    </p>
                    <p className="text-xs text-muted-foreground">Entries</p>
                  </div>
                  <div className="rounded-lg border bg-card p-3 text-center">
                    <p className="text-2xl font-bold text-teal-600">
                      {new Set(monthlyData.entries.map((e) => e.date)).size}
                    </p>
                    <p className="text-xs text-muted-foreground">Active Days</p>
                  </div>
                  <div className="rounded-lg border bg-card p-3 text-center">
                    <p className="text-2xl font-bold text-teal-600">
                      {monthlyData.categoryBreakdown.length}
                    </p>
                    <p className="text-xs text-muted-foreground">Categories</p>
                  </div>
                  <div className="rounded-lg border bg-card p-3 text-center">
                    <p className="text-2xl font-bold text-teal-600">
                      {monthlyData.categoryBreakdown[0]?.category || "-"}
                    </p>
                    <p className="text-xs text-muted-foreground">Top Category</p>
                  </div>
                </div>
              )}

              {/* Category Breakdown */}
              {monthlyData?.categoryBreakdown && monthlyData.categoryBreakdown.length > 0 && (
                <div className="mb-6 rounded-lg border bg-card p-4">
                  <h3 className="mb-3 text-sm font-semibold">Categories</h3>
                  <div className="flex flex-wrap gap-2">
                    {monthlyData.categoryBreakdown.map((cat) => (
                      <Badge
                        key={cat.category}
                        variant="secondary"
                        className={`${CATEGORY_COLORS[cat.category] || CATEGORY_COLORS.general}`}
                      >
                        {cat.category}: {cat.count}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Compiled Journal / Compile Button */}
              {monthlyData?.monthlyJournal ? (
                <div className="mb-6 rounded-lg border bg-card p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="flex items-center gap-2 text-sm font-semibold">
                      <Sparkles className="h-4 w-4 text-amber-500" />
                      Monthly Summary
                    </h3>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => compileMutation.mutate()}
                      disabled={compileMutation.isPending}
                    >
                      Recompile
                    </Button>
                  </div>
                  {monthlyData.monthlyJournal.summary && (
                    <p className="mb-3 text-sm leading-relaxed text-muted-foreground">
                      {monthlyData.monthlyJournal.summary}
                    </p>
                  )}
                  {monthlyData.monthlyJournal.highlights &&
                    monthlyData.monthlyJournal.highlights.length > 0 && (
                      <div className="mt-3">
                        <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                          Highlights
                        </p>
                        <ul className="space-y-1">
                          {monthlyData.monthlyJournal.highlights.map((h, i) => (
                            <li
                              key={i}
                              className="flex items-start gap-2 text-sm"
                            >
                              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-500" />
                              {h}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  {monthlyData.monthlyJournal.compiled_at && (
                    <p className="mt-3 text-xs text-muted-foreground">
                      Compiled{" "}
                      {format(
                        new Date(monthlyData.monthlyJournal.compiled_at),
                        "MMM d, yyyy 'at' h:mm a"
                      )}
                    </p>
                  )}
                </div>
              ) : (
                monthlyData &&
                monthlyData.entries.length > 0 && (
                  <div className="mb-6 rounded-lg border border-dashed bg-card p-6 text-center">
                    <Sparkles className="mx-auto h-8 w-8 text-amber-500/50" />
                    <p className="mt-2 text-sm font-medium">
                      Compile Monthly Journal
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      AI will summarize your {monthlyData.entries.length} entries
                      into a cohesive monthly review
                    </p>
                    <Button
                      className="mt-3"
                      size="sm"
                      onClick={() => compileMutation.mutate()}
                      disabled={compileMutation.isPending}
                    >
                      <Sparkles className="mr-1.5 h-4 w-4" />
                      {compileMutation.isPending
                        ? "Compiling..."
                        : "Compile with AI"}
                    </Button>
                  </div>
                )
              )}

              {/* Monthly Entries Timeline */}
              {monthlyData?.entries && monthlyData.entries.length > 0 ? (
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold">All Entries</h3>
                  {Object.entries(
                    monthlyData.entries.reduce(
                      (acc: Record<string, JournalEntry[]>, entry) => {
                        if (!acc[entry.date]) acc[entry.date] = [];
                        acc[entry.date].push(entry);
                        return acc;
                      },
                      {}
                    )
                  ).map(([date, dayEntries]) => (
                    <div key={date}>
                      <button
                        onClick={() => goToDate(date)}
                        className="mb-2 text-xs font-medium text-teal-600 hover:underline dark:text-teal-400"
                      >
                        {format(
                          new Date(date + "T12:00:00"),
                          "EEEE, MMMM d"
                        )}
                      </button>
                      <div className="space-y-2 border-l-2 border-teal-200 pl-4 dark:border-teal-800">
                        {dayEntries.map((entry) => (
                          <div key={entry.id} className="text-sm">
                            <span className="text-muted-foreground">
                              {entry.entry_text}
                            </span>
                            {entry.category !== "general" && (
                              <Badge
                                variant="secondary"
                                className={`ml-2 text-[10px] ${CATEGORY_COLORS[entry.category] || ""}`}
                              >
                                {entry.category}
                              </Badge>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-12 text-center">
                  <BookOpen className="mx-auto h-12 w-12 text-muted-foreground/30" />
                  <p className="mt-4 text-lg font-medium text-muted-foreground">
                    No entries this month
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Start journaling to build your monthly review.
                  </p>
                  <Button
                    className="mt-4"
                    variant="outline"
                    size="sm"
                    onClick={() => goToDate(format(new Date(), "yyyy-MM-dd"))}
                  >
                    <Plus className="mr-1.5 h-4 w-4" />
                    Start Today
                  </Button>
                </div>
              )}

              {/* Available Months Navigation */}
              {monthlyData?.availableMonths &&
                monthlyData.availableMonths.length > 1 && (
                  <div className="mt-6 rounded-lg border bg-card p-4">
                    <h3 className="mb-2 text-sm font-semibold">
                      Journal History
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {monthlyData.availableMonths.map((m) => (
                        <Button
                          key={`${m.year}-${m.month}`}
                          variant={
                            m.year === selectedYear &&
                            m.month === selectedMonth
                              ? "default"
                              : "outline"
                          }
                          size="sm"
                          onClick={() => {
                            setSelectedYear(m.year);
                            setSelectedMonth(m.month);
                          }}
                        >
                          {MONTH_NAMES[m.month - 1].slice(0, 3)} {m.year} (
                          {m.count})
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
            </>
          )}
        </>
      )}
    </div>
  );
}

/**
 * One day's sheet: what was saved, what is still on its way, and the line to
 * write the next entry on.
 */
function DailyPage({
  date,
  isToday,
  autoFocus,
  outbox,
  waitingElsewhere,
  onSubmit,
  onRetry,
}: {
  date: string;
  isToday: boolean;
  autoFocus: boolean;
  outbox: OutboxEntry[];
  waitingElsewhere: number;
  onSubmit: (text: string, date: string) => void;
  onRetry: (entry: OutboxEntry) => void;
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // The draft survives refreshes and day changes. Only rendered once the
  // query has loaded, so this never runs during server rendering.
  const [input, setInput] = useState(() => readDraft(date));

  const { data: dailyData, isLoading, isError, refetch } = useQuery({
    queryKey: ["journal", "daily", date],
    queryFn: async () => {
      const res = await fetch(`/api/journal?date=${date}`);
      if (!res.ok) throw new Error("Failed to fetch journal entries");
      return res.json() as Promise<{ entries: JournalEntry[] }>;
    },
    retry: 2,
  });

  const changeInput = (value: string) => {
    setInput(value);
    writeDraft(date, value);
  };

  const submit = () => {
    if (!input.trim()) return;
    onSubmit(input, date);
    changeInput("");
    inputRef.current?.focus();
  };

  // Put a failed entry back in the composer to change it (e.g. too long).
  const editBack = (entry: OutboxEntry) => {
    changeInput(input.trim() ? `${input.trimEnd()}\n${entry.text}` : entry.text);
    removeFromOutbox(entry.id);
    inputRef.current?.focus();
  };

  useEffect(() => {
    if (autoFocus && !isLoading) inputRef.current?.focus();
  }, [autoFocus, isLoading]);

  // Grow the composer to fit its content in *whole* writing lines, so it reads
  // as the next lines of the page instead of a box with a scrollbar in it.
  // Rounding up to a whole line matters: the page's ruling is painted per block
  // on a fixed rhythm, so a composer sized to a fractional line shifts every
  // rule beneath it off the lines above.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const line = parseFloat(getComputedStyle(el).lineHeight) || 32;
    el.style.height = "auto";
    const lines = Math.max(1, Math.ceil(el.scrollHeight / line));
    el.style.height = `${lines * line}px`;
  }, [input, isLoading]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter while an IME is composing (Japanese, Chinese, Korean, some
    // Android keyboards) confirms the composition; it must not save.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  // Read top to bottom like a page, with the composer as the next line.
  const entries = [...(dailyData?.entries ?? [])].sort((a, b) =>
    (parseDbTimestamp(a.created_at)?.getTime() ?? 0) -
    (parseDbTimestamp(b.created_at)?.getTime() ?? 0)
  );
  const savedIds = new Set(entries.map((e) => e.id));
  const pending = outbox.filter((e) => e.date === date && !savedIds.has(e.id));
  const failedCount = pending.filter((e) => e.status === "failed").length;
  const dayLabel = format(new Date(date + "T12:00:00"), "MMMM d");

  return (
    <>
      <div className="bp-notebook-page bp-notebook-page-full-rule">
        {isLoading ? (
          <p className="bp-page-note">Opening the page&hellip;</p>
        ) : (
          <>
            {isError && (
              <p className="bp-page-note" role="alert">
                Couldn&rsquo;t load this page.{" "}
                <button type="button" className="bp-entry-action" onClick={() => refetch()}>
                  Try again
                </button>{" "}
                You can still write; entries save as soon as the connection is back.
              </p>
            )}

            {!isError && entries.length === 0 && pending.length === 0 && (
              <p className="bp-page-note">
                {isToday ? "Nothing written yet today." : `Nothing was written on ${dayLabel}.`}
              </p>
            )}

            {entries.map((entry) => {
              const at = parseDbTimestamp(entry.created_at);
              return (
                <p key={entry.id} className="bp-entry">
                  {entry.entry_text}{" "}
                  <span className="bp-entry-meta">
                    {at && <>&mdash; {format(at, "h:mm a")}</>}
                    {entry.category && entry.category !== "general" && (
                      <>
                        {" · "}
                        <span className="bp-entry-cat">{entry.category}</span>
                      </>
                    )}
                    {entry.mood && <>{" · "}{entry.mood}</>}
                    {Array.isArray(entry.tags) && entry.tags.length > 0 && (
                      <>{" · "}{entry.tags.join(", ")}</>
                    )}
                  </span>
                </p>
              );
            })}

            {pending.map((entry) => (
              <p key={entry.id} className="bp-entry bp-entry-pending">
                {entry.text}{" "}
                {entry.status === "saving" ? (
                  <span className="bp-entry-meta" aria-live="polite">&mdash; saving&hellip;</span>
                ) : (
                  <span className="bp-entry-meta bp-entry-failed" role="alert">
                    &mdash; {entry.error || "Not saved yet."}{" "}
                    {!entry.permanent && (
                      <button type="button" className="bp-entry-action" onClick={() => onRetry(entry)}>
                        Retry
                      </button>
                    )}{" "}
                    <button type="button" className="bp-entry-action" onClick={() => editBack(entry)}>
                      Edit
                    </button>
                  </span>
                )}
              </p>
            ))}

            {/* The composer is simply the next line on the page. */}
            <div className="bp-compose">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => changeInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={isToday ? "What happened today?" : `What happened on ${dayLabel}?`}
                aria-label={isToday ? "New journal entry for today" : `New journal entry for ${dayLabel}`}
                className="bp-compose-input"
                rows={1}
                maxLength={MAX_ENTRY_CHARS}
              />
            </div>
          </>
        )}
      </div>

      {/* Below the page: the actions that are about the page, not on it. */}
      <div className="flex items-center justify-between gap-3 border-t px-3 py-2 text-xs text-muted-foreground">
        <span aria-live="polite">
          {failedCount > 0
            ? `${failedCount} not saved yet · kept on this device`
            : entries.length > 0
              ? `${entries.length} ${entries.length === 1 ? "entry" : "entries"}`
              : "Enter to save · Shift+Enter for a new line"}
          {waitingElsewhere > 0 && ` · ${waitingElsewhere} waiting to save on other days`}
        </span>
        <Button
          size="sm"
          className="h-8"
          onClick={submit}
          disabled={isLoading || !input.trim()}
        >
          <Send className="mr-1.5 h-3.5 w-3.5" />
          Add entry
        </Button>
      </div>
    </>
  );
}
