/**
 * Labels for dates and states, shared by every Operations surface.
 * Pure, so the wording is unit-tested rather than eyeballed.
 */

import type { AutomationStatus, OpsItem } from "./types";

function toUtcMs(day: string): number {
  return Date.parse(`${day.slice(0, 10)}T00:00:00Z`);
}

const SHORT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });

/**
 * "Today", "Tomorrow", "Fri", "Oct 12", "3d overdue". `tone` says how loudly
 * the UI should show it. Days are whole calendar days in the user's zone.
 */
export function dateLabel(
  day: string | null,
  today: string
): { text: string; tone: "late" | "soon" | "plain" } | null {
  if (!day) return null;
  const diff = Math.round((toUtcMs(day) - toUtcMs(today)) / 86_400_000);
  if (Number.isNaN(diff)) return null;
  if (diff < 0) return { text: `${-diff}d overdue`, tone: "late" };
  if (diff === 0) return { text: "Today", tone: "soon" };
  if (diff === 1) return { text: "Tomorrow", tone: "soon" };
  if (diff < 7) return { text: WEEKDAY.format(toUtcMs(day)), tone: "plain" };
  return { text: SHORT.format(toUtcMs(day)), tone: "plain" };
}

/** Relative time for a SQLite UTC timestamp ("2026-10-01 12:00:00") or ISO. */
export function timeAgo(value: string | null, now: number = Date.now()): string | null {
  if (!value) return null;
  const iso = /[Zz]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value.replace(" ", "T")}Z`;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  const minutes = Math.round((now - then) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  return months < 12 ? `${months}mo ago` : `${Math.round(months / 12)}y ago`;
}

/** One line describing who holds the item, in plain words. */
export function ownershipLine(item: OpsItem): string | null {
  const who = item.ops.counterparty;
  switch (item.ops.kind) {
    case "waiting":
      return who ? `Waiting on ${who}` : "Waiting on someone (not named)";
    case "commitment":
      if (item.ops.direction === "they_owe") return who ? `${who} promised you` : "Promised to you";
      return who ? `You promised ${who}` : "You promised";
    case "decision":
      return "Your call";
    default:
      if (item.ops.blocked) {
        return item.ops.blocked_by === "me" ? "Blocked on you" : `Blocked by ${item.ops.blocked_by}`;
      }
      if (item.ops.owner === "other") return who ? `${who} has it` : "Someone else has it";
      if (item.ops.owner === "system") return "An automation has it";
      return null;
  }
}

export const AUTOMATION_STATUS_LABELS: Record<AutomationStatus, string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  failing: "Failing",
  paused: "Paused",
  unknown: "Unknown",
  not_connected: "Not connected",
};
