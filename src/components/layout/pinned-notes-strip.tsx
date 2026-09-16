"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Pin } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface PinnedNote {
  id: string;
  title: string;
  slug: string;
  project_name: string | null;
  project_color: string | null;
}

function useIsMounted() {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  return mounted;
}

import React from "react";

export function PinnedNotesStrip({ variant }: { variant: "mobile" | "desktop" }) {
  const mounted = useIsMounted();

  const { data } = useQuery({
    queryKey: ["notes", "pinned"],
    queryFn: async () => {
      const res = await fetch("/api/notes?pinned=true&limit=20");
      if (!res.ok) throw new Error("Failed to fetch pinned notes");
      const json = await res.json();
      return json.notes as PinnedNote[];
    },
    staleTime: 1000 * 30,
    enabled: mounted,
  });

  const notes = data ?? [];
  if (notes.length === 0) return null;

  if (variant === "mobile") {
    return (
      <div className="flex gap-2 overflow-x-auto px-4 py-2 scrollbar-hide">
        {notes.map((note, i) => (
          <motion.div
            key={note.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04, duration: 0.2 }}
          >
            <Link
              href={`/notes/${note.slug}`}
              className="flex items-center gap-1.5 rounded-full border bg-background px-3 py-1.5 text-xs font-medium whitespace-nowrap hover:bg-muted transition-colors"
            >
              <Pin className="h-3 w-3 text-muted-foreground shrink-0" />
              {note.project_color && (
                <span
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: note.project_color }}
                />
              )}
              <span className="truncate max-w-[140px]">{note.title}</span>
            </Link>
          </motion.div>
        ))}
      </div>
    );
  }

  // Desktop variant
  return (
    <div className="px-3 py-2">
      <h3 className="text-xs font-medium text-muted-foreground mb-2 px-3">Pinned</h3>
      <nav className="space-y-0.5">
        {notes.map((note) => (
          <Link
            key={note.id}
            href={`/notes/${note.slug}`}
            className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors",
              "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Pin className="h-3 w-3 shrink-0" />
            {note.project_color && (
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{ backgroundColor: note.project_color }}
              />
            )}
            <span className="truncate">{note.title}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
