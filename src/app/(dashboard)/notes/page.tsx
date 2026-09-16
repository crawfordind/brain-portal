"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar, FileText, Mic, Plus, RefreshCw } from "lucide-react";
import Link from "next/link";
import { format } from "date-fns";
import type { Note } from "@/lib/db/schema";

type FilterType = "all" | "daily" | "regular" | "voice";

export default function NotesPage() {
  const router = useRouter();
  const [filter, setFilter] = useState<FilterType>("all");

  const { data: notes, isLoading, isError, refetch } = useQuery({
    queryKey: ["notes", filter],
    queryFn: async () => {
      let url = "/api/notes?archived=false";
      if (filter === "daily") {
        url += "&type=daily";
      } else if (filter === "regular") {
        url += "&type=note";
      } else if (filter === "voice") {
        url += "&source=voice";
      }
      const response = await fetch(url);
      if (!response.ok) throw new Error("Failed to fetch notes");
      const data = await response.json();
      return data.notes as Note[];
    },
  });

  const [isCreatingDaily, setIsCreatingDaily] = useState(false);

  const handleCreateDaily = async () => {
    setIsCreatingDaily(true);
    try {
      const today = new Date().toISOString().split("T")[0];
      const response = await fetch(`/api/daily?date=${today}`);

      if (response.ok) {
        const data = await response.json();
        if (data.note) {
          router.push(`/notes/${data.note.slug}`);
          return;
        }
      }

      const createResponse = await fetch("/api/daily", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: today }),
      });

      if (!createResponse.ok) {
        throw new Error("Failed to create daily note");
      }

      const data = await createResponse.json();
      router.push(`/notes/${data.note.slug}`);
    } catch {
      toast.error("Failed to open daily note. Please try again.");
    } finally {
      setIsCreatingDaily(false);
    }
  };

  return (
    <div className="p-3 lg:p-6 space-y-3 lg:space-y-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 lg:gap-4">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold mb-1">Notes</h1>
          <p className="text-xs lg:text-sm text-muted-foreground">
            All your notes in one place
          </p>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <Button onClick={handleCreateDaily} disabled={isCreatingDaily} variant="outline" className="flex-1 sm:flex-initial h-9 lg:h-10 text-xs lg:text-sm">
            <Calendar className="h-3 w-3 lg:h-4 lg:w-4 lg:mr-2" />
            <span className="hidden sm:inline">{isCreatingDaily ? "Opening..." : "Today's Daily"}</span>
            <span className="sm:hidden ml-1">{isCreatingDaily ? "..." : "Daily"}</span>
          </Button>
          <Button asChild className="flex-1 sm:flex-initial h-9 lg:h-10 text-xs lg:text-sm">
            <Link href="/notes/new">
              <Plus className="h-3 w-3 lg:h-4 lg:w-4 lg:mr-2" />
              <span className="hidden sm:inline">New Note</span>
              <span className="sm:hidden ml-1">New</span>
            </Link>
          </Button>
        </div>
      </div>

      {/* Filter Chips */}
      <div className="flex gap-2 flex-wrap" role="group" aria-label="Filter notes">
        {([
          { value: "all" as const, label: "All Notes", icon: null },
          { value: "daily" as const, label: "Daily Notes", icon: Calendar },
          { value: "regular" as const, label: "Regular Notes", icon: FileText },
          { value: "voice" as const, label: "Voice Notes", icon: Mic },
        ] as const).map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            aria-pressed={filter === value}
            className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-full"
          >
            <Badge
              variant={filter === value ? "default" : "outline"}
              className="cursor-pointer text-xs lg:text-sm h-6 lg:h-7"
            >
              {Icon && <Icon className="h-3 w-3 mr-1" />}
              {label}
            </Badge>
          </button>
        ))}
      </div>

      {/* Notes List */}
      {isLoading ? (
        <div className="space-y-2 lg:space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-20 lg:h-24 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center justify-center py-8 lg:py-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/10 mb-3">
            <RefreshCw className="h-5 w-5 text-destructive" />
          </div>
          <h2 className="text-base lg:text-lg font-semibold mb-1">Couldn&apos;t load notes</h2>
          <p className="text-xs lg:text-sm text-muted-foreground mb-3 px-4">
            Something went wrong. Check your connection and try again.
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Try again
          </Button>
        </div>
      ) : !notes || notes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 lg:py-12 text-center">
          <FileText className="h-8 w-8 lg:h-12 lg:w-12 text-muted-foreground mb-3 opacity-50" />
          <h2 className="text-base lg:text-lg font-semibold mb-1">
            {filter === "all" ? "No notes yet" : `No ${filter} notes`}
          </h2>
          <p className="text-xs lg:text-sm text-muted-foreground mb-3 px-4">
            {filter === "all"
              ? "Start writing to build your knowledge base."
              : "Try a different filter or create a new note."}
          </p>
          <div className="flex gap-2">
            {filter !== "all" && (
              <Button variant="outline" onClick={() => setFilter("all")} className="h-9 text-xs lg:text-sm">
                Show all
              </Button>
            )}
            <Button asChild className="h-9 text-xs lg:text-sm">
              <Link href="/notes/new">
                <Plus className="h-3 w-3 lg:h-4 lg:w-4 mr-1" />
                New Note
              </Link>
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2 lg:space-y-3">
          {notes.map((note) => (
            <Link
              key={note.id}
              href={`/notes/${note.slug}`}
              className="block p-3 lg:p-4 rounded-lg border hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-start gap-2 lg:gap-3">
                {note.note_type === "daily" ? (
                  <Calendar className="h-4 w-4 lg:h-5 lg:w-5 text-primary mt-0.5 flex-shrink-0" />
                ) : (() => {
                  try {
                    const meta = typeof note.metadata === 'string' ? JSON.parse(note.metadata || '{}') : (note.metadata || {});
                    if (meta.source === 'voice') {
                      return <Mic className="h-4 w-4 lg:h-5 lg:w-5 text-violet-500 mt-0.5 flex-shrink-0" />;
                    }
                  } catch {}
                  return <FileText className="h-4 w-4 lg:h-5 lg:w-5 text-muted-foreground mt-0.5 flex-shrink-0" />;
                })()}
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-sm lg:text-base mb-1 line-clamp-2">{note.title}</h3>
                  {note.content_plain && (
                    <p className="text-xs lg:text-sm text-muted-foreground line-clamp-2">
                      {note.content_plain.length > 150
                        ? `${note.content_plain.substring(0, 150)}...`
                        : note.content_plain}
                    </p>
                  )}
                  <p className="text-[10px] lg:text-xs text-muted-foreground mt-1 lg:mt-2">
                    {format(new Date(note.updated_at), "MMM d, yyyy 'at' h:mm a")}
                  </p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
