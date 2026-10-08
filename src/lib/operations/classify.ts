/**
 * Deciding what the Operations home shows.
 *
 * Pure: items in, bounded sections out. The page must answer "what needs me"
 * without reproducing every open task, so two rules hold:
 *
 * - **Each item appears once.** A blocked decision that is overdue is listed
 *   under the first section that claims it, in the order below. Listing it
 *   three times makes the screen look three times as busy as it is.
 * - **Each section is capped.** The total is kept so the heading can say
 *   "12" while showing five, and "see all" leads to the full list.
 *
 * Proposed items (not yet confirmed by the user) never appear here. They are
 * suggestions, and the home screen lists commitments.
 */

import { addDaysToDate } from "@/lib/email/when";
import type { OpsItem, OpsSection } from "./types";

const PRIORITY_RANK: Record<OpsItem["priority"], number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export function isOpen(item: OpsItem): boolean {
  return item.status === "pending" || item.status === "in_progress";
}

/** Earliest date first, undated last, then by priority. */
export function compareItems(a: OpsItem, b: OpsItem): number {
  if (a.nextDate !== b.nextDate) {
    if (!a.nextDate) return 1;
    if (!b.nextDate) return -1;
    return a.nextDate < b.nextDate ? -1 : 1;
  }
  return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
}

/** Date part of a stored due date, which may carry a time. */
export function dayOf(value: string | null): string | null {
  return value ? value.slice(0, 10) : null;
}

export function isOverdue(item: OpsItem, today: string): boolean {
  const due = dayOf(item.dueDate);
  return !!due && due < today;
}

/** A waited-on thing whose promised date has passed. */
export function isLate(item: OpsItem, today: string): boolean {
  const expected = item.ops.expected_at ?? dayOf(item.dueDate);
  return !!expected && expected < today;
}

export interface SectionCaps {
  today: number;
  other: number;
}

const DEFAULT_CAPS: SectionCaps = { today: 7, other: 5 };

interface SectionRule {
  key: string;
  title: string;
  hint: string;
  moreHref: string;
  cap: "today" | "other";
  matches: (item: OpsItem, today: string, weekEnd: string, monthEnd: string) => boolean;
}

const RULES: SectionRule[] = [
  {
    key: "today",
    title: "Today",
    hint: "Overdue or due today, and yours to move",
    moreHref: "/tasks",
    cap: "today",
    matches: (item, today) => {
      const due = dayOf(item.dueDate);
      return (
        item.ops.owner === "me" &&
        !item.ops.blocked &&
        !!due &&
        due <= today
      );
    },
  },
  {
    key: "blocked",
    title: "Blocked",
    hint: "Cannot move until something else does",
    moreHref: "/operations/follow-through?view=blocked",
    cap: "other",
    matches: (item) => item.ops.blocked,
  },
  {
    key: "decisions",
    title: "Decisions",
    hint: "Choices only you can make",
    moreHref: "/operations/follow-through?view=decisions",
    cap: "other",
    matches: (item) => item.ops.kind === "decision",
  },
  {
    key: "waiting",
    title: "Waiting on",
    hint: "Someone else owes the next move",
    moreHref: "/operations/follow-through?view=waiting",
    cap: "other",
    matches: (item) =>
      item.ops.kind === "waiting" ||
      (item.ops.owner !== "me" && item.ops.kind !== "commitment"),
  },
  {
    key: "commitments",
    title: "Commitments",
    hint: "Promises made, due within a month or undated",
    moreHref: "/operations/follow-through?view=commitments",
    cap: "other",
    matches: (item, _today, _weekEnd, monthEnd) => {
      if (item.ops.kind !== "commitment") return false;
      return !item.nextDate || item.nextDate <= monthEnd;
    },
  },
  {
    key: "week",
    title: "This week",
    hint: "Real deadlines in the next seven days",
    moreHref: "/tasks",
    cap: "other",
    matches: (item, today, weekEnd) => {
      const due = dayOf(item.dueDate);
      return !!due && due > today && due <= weekEnd;
    },
  },
];

export function buildHomeSections(
  items: OpsItem[],
  today: string,
  caps: SectionCaps = DEFAULT_CAPS
): OpsSection[] {
  const weekEnd = addDaysToDate(today, 7);
  const monthEnd = addDaysToDate(today, 31);
  const claimed = new Set<string>();
  const live = items
    .filter((item) => isOpen(item) && item.ops.state === "confirmed")
    .sort(compareItems);

  return RULES.map((rule) => {
    const matching = live.filter(
      (item) => !claimed.has(item.id) && rule.matches(item, today, weekEnd, monthEnd)
    );
    matching.forEach((item) => claimed.add(item.id));
    return {
      key: rule.key,
      title: rule.title,
      hint: rule.hint,
      items: matching.slice(0, caps[rule.cap]),
      total: matching.length,
      moreHref: rule.moreHref,
    };
  });
}

export interface OpsCounts {
  overdue: number;
  dueToday: number;
  decisions: number;
  blocked: number;
  waiting: number;
  commitments: number;
  proposed: number;
}

/** Whole-population counts, independent of the per-section de-duplication. */
export function countItems(items: OpsItem[], today: string): OpsCounts {
  const open = items.filter(isOpen);
  const confirmed = open.filter((i) => i.ops.state === "confirmed");
  return {
    overdue: confirmed.filter((i) => i.ops.owner === "me" && isOverdue(i, today)).length,
    dueToday: confirmed.filter((i) => dayOf(i.dueDate) === today).length,
    decisions: confirmed.filter((i) => i.ops.kind === "decision").length,
    blocked: confirmed.filter((i) => i.ops.blocked).length,
    waiting: confirmed.filter((i) => i.ops.kind === "waiting").length,
    commitments: confirmed.filter((i) => i.ops.kind === "commitment").length,
    proposed: open.filter((i) => i.ops.state === "proposed").length,
  };
}

/** Views offered by the follow-through page, and the agent tools. */
export const FOLLOW_THROUGH_VIEWS = [
  "decisions",
  "waiting",
  "commitments",
  "blocked",
] as const;
export type FollowThroughView = (typeof FOLLOW_THROUGH_VIEWS)[number];

export function filterView(
  items: OpsItem[],
  view: FollowThroughView
): OpsItem[] {
  const live = items.filter(isOpen);
  const pick = (item: OpsItem) => {
    switch (view) {
      case "decisions":
        return item.ops.kind === "decision";
      case "waiting":
        return item.ops.kind === "waiting";
      case "commitments":
        return item.ops.kind === "commitment";
      case "blocked":
        return item.ops.blocked;
    }
  };
  return live.filter(pick).sort(compareItems);
}
