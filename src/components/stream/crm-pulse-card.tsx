"use client";

/**
 * The CRM's place on the dashboard.
 *
 * The CRM shipped with four screens of its own and no presence here at all, so
 * the one question it exists to answer — *is there a person I owe something
 * to?* — was only reachable by remembering to go looking for it.
 *
 * It earns its space by scaling with what it has to say:
 *
 * - No contacts yet → renders nothing. An empty CRM is not news.
 * - Nothing pending → one quiet line: how many contacts, when you last spoke.
 * - Something pending → a card naming the decision and linking straight at it.
 *
 * The pending counts also appear as pills in `NeedsYou`; that row is the
 * "what's waiting" index, this is where the CRM's own context lives.
 */

import Link from "next/link";
import { ArrowRight, Boxes, Users } from "lucide-react";
import type { CrmPulse } from "@/lib/crm/pulse";
import { Badge } from "@/components/ui/badge";

const CHANNEL_LABELS: Record<string, string> = {
  email: "Email",
  call: "Call",
  sms: "SMS",
  dm: "DM",
  meeting: "Meeting",
  event: "Event",
  note: "Note",
  other: "Touch",
};

/** Short relative time. `null` for an unparseable or absent timestamp. */
function relativeTime(iso: string): string | null {
  // SQLite `datetime('now')` has no zone marker; it is UTC by definition.
  const normalized = /[Zz]|[+-]\d{2}:?\d{2}$/.test(iso)
    ? iso
    : `${iso.replace(" ", "T")}Z`;
  const then = new Date(normalized).getTime();
  if (Number.isNaN(then)) return null;

  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.round(days / 30)}mo ago`;
}

export function CrmPulseCard({ pulse }: { pulse: CrmPulse }) {
  if (!pulse.hasContacts) return null;

  const pending = pulse.needsReview + pulse.followUpsDue;
  const lastTouch = pulse.recentTouches[0];

  if (pending === 0) {
    const when = lastTouch ? relativeTime(lastTouch.occurredAt) : null;
    return (
      <Link
        href="/crm"
        className="flex items-center gap-2 px-1 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <Users className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">
          {pulse.contactCount} contact{pulse.contactCount === 1 ? "" : "s"}
          {lastTouch?.contactName && when && (
            <> · last touch {lastTouch.contactName}, {when}</>
          )}
        </span>
        <ArrowRight className="ml-auto h-3.5 w-3.5 shrink-0 opacity-60" />
      </Link>
    );
  }

  return (
    <section className="rounded-xl border bg-card">
      <div className="flex items-center justify-between gap-2 border-b px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-medium">People</h2>
          <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
            {pulse.contactCount}
          </Badge>
        </div>
        <Link
          href="/crm/ventures"
          className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <Boxes className="h-3.5 w-3.5" />
          Ventures
        </Link>
      </div>

      <div className="divide-y">
        {pulse.needsReview > 0 && (
          <PendingRow
            href="/crm?tab=unresolved"
            title={`${pulse.needsReview} contact${pulse.needsReview === 1 ? "" : "s"} need sorting`}
            detail="Unresolved captures and possible duplicates"
          />
        )}
        {pulse.followUpsDue > 0 && (
          <PendingRow
            href="/crm"
            title={`${pulse.followUpsDue} follow-up${pulse.followUpsDue === 1 ? "" : "s"} due`}
            detail="You set a date and it has arrived"
          />
        )}
      </div>

      {pulse.recentTouches.length > 0 && (
        <div className="border-t px-3.5 py-2">
          <ul className="space-y-1">
            {pulse.recentTouches.map((touch) => {
              const when = relativeTime(touch.occurredAt);
              return (
                <li
                  key={touch.id}
                  className="flex items-baseline gap-2 text-[11px] text-muted-foreground"
                >
                  <span className="truncate font-medium text-foreground">
                    {touch.contactName ?? "Unresolved"}
                  </span>
                  <span className="truncate">
                    {CHANNEL_LABELS[touch.channel] ?? touch.channel}
                    {touch.subject ? ` · ${touch.subject}` : ""}
                  </span>
                  {when && <span className="ml-auto shrink-0">{when}</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

function PendingRow({
  href,
  title,
  detail,
}: {
  href: string;
  title: string;
  detail: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-muted/50"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{title}</p>
        <p className="truncate text-[11px] text-muted-foreground">{detail}</p>
      </div>
      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}
