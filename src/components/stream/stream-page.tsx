"use client";

/**
 * Stream Page — the dashboard.
 *
 * Ordered by how urgently each band needs the user, so the page answers
 * "anything for me?" before it answers "what have I got?":
 *
 *   1. Greeting — where you are, one line.
 *   2. Brain Bar — the one thing you always came here to do.
 *   3. Needs you — only what is waiting. Absent when nothing is.
 *   4. People — the CRM, sized to how much it has to say. Absent when empty.
 *   5. Stream — everything else, filtered.
 *
 * Bands 3 and 4 render nothing at all on a quiet day, so a user with an empty
 * queue sees the input and their stream and nothing else.
 */

import { BrainBar } from "./brain-bar";
import { StreamFeed } from "./stream-feed";
import { Searchlight } from "./searchlight";
import { NeedsYou } from "./needs-you";
import { CrmPulseCard } from "./crm-pulse-card";
import type { StreamStats } from "@/lib/stream/stats";
import type { CrmPulse } from "@/lib/crm/pulse";

function getClientGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

interface StreamPageProps {
  stats: StreamStats;
  crm: CrmPulse;
  greeting: string;
}

export function StreamPage({ stats, crm, greeting: serverGreeting }: StreamPageProps) {
  /*
   * The greeting and the date are the same sentence, so they are one line.
   * As two stacked blocks they cost ~56px of the ~960px a 1080p screen has —
   * the single most expensive sentence on the page, for eight words that never
   * change what anyone does next.
   *
   * The server renders in *its* timezone and the client in the viewer's, so
   * these two nodes legitimately differ on hydration. That used to be corrected
   * with a `setState` inside an effect — a cascading render for a string.
   * `suppressHydrationWarning` is the escape hatch meant for exactly this
   * (locale- and clock-dependent text) and costs no extra render.
   */
  const greeting = typeof window === "undefined" ? serverGreeting : getClientGreeting();

  return (
    <div className="space-y-4">
      {/* Greeting, date and the day's one piece of encouragement — one line. */}
      <div className="relative flex items-baseline gap-3 overflow-hidden py-1">
        <Searchlight />
        <h1
          className="relative text-base font-semibold lg:text-lg"
          suppressHydrationWarning
        >
          {greeting}
        </h1>
        <p
          className="relative ml-auto shrink-0 text-xs text-muted-foreground"
          suppressHydrationWarning
        >
          {new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(new Date())}
          {stats.completedToday > 0 && (
            <span className="text-emerald-600 dark:text-emerald-400">
              {" "}· {stats.completedToday} done
            </span>
          )}
        </p>
      </div>

      {/* Brain Bar */}
      <BrainBar
        variant="default"
        onSubmit={() => {
          window.dispatchEvent(new CustomEvent("stream-refresh"));
        }}
      />

      {/* Everything waiting on the user, in one row. Empty = nothing rendered. */}
      <NeedsYou
        counts={{
          overdueTasks: stats.overdueTasks,
          dueTodayTasks: stats.dueTodayTasks,
          awaitingReview: stats.awaitingReview,
          crmNeedsReview: crm.needsReview,
          crmFollowUpsDue: crm.followUpsDue,
        }}
      />

      {/* The CRM. Renders nothing until there are contacts. */}
      <CrmPulseCard pulse={crm} />

      {/* Stream Feed */}
      <StreamFeed />
    </div>
  );
}
