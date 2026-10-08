/**
 * Intake triage: what a raw capture probably is.
 *
 * Pure and deterministic, in the same spirit as Note Lenses ("the model reads;
 * rules choose"): the same words always get the same proposal, and every
 * proposal says *why* in plain language. No model is called, so proposing
 * costs nothing and runs on every capture as the page loads.
 *
 * A proposal is never written anywhere. It becomes a record only when the user
 * confirms it (see `intake.ts`). That is the guardrail: an idea, an email or a
 * research note is never silently turned into a commitment.
 *
 * Where the rules find nothing, the proposal says so (`confidence: "unclear"`)
 * rather than inventing a kind.
 */

import { addDaysToDate } from "@/lib/email/when";
import type { OpsDirection, OpsKind } from "./types";

export type TriageKind = OpsKind | "reference" | "context";

export const TRIAGE_KIND_LABELS: Record<TriageKind, string> = {
  action: "Task",
  decision: "Decision",
  waiting: "Waiting on",
  commitment: "Commitment",
  reference: "Reference",
  context: "Context",
};

export interface TriageInput {
  content: string;
  captureType: string | null;
  capturedAt: string | null;
}

export interface TriageProject {
  id: string;
  name: string;
  ventureName?: string | null;
}

export interface TriageContact {
  id: string;
  name: string;
}

export interface TriageProposal {
  kind: TriageKind;
  confidence: "clear" | "unclear";
  title: string;
  dueDate: string | null;
  /** The words the due date was read from, so the user can judge it. */
  dueBasis: string | null;
  projectId: string | null;
  projectName: string | null;
  counterparty: string | null;
  counterpartyEntityId: string | null;
  direction: OpsDirection | null;
  options: string[];
  /** Plain-language reasons, one per rule that fired. */
  reasons: string[];
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
];

const WAITING_RE =
  /\b(?:waiting (?:on|for)|waiting to hear (?:back )?from|haven'?t heard (?:back )?from|still need .{1,40}? from|pending (?:approval |reply |response )?from|expecting .{1,40}? from)\b/i;
/** Capitalised words right after the trigger: "waiting on Will Baker to…" → "Will Baker". */
const NAME_AFTER_RE = /^\s+((?:[A-Z][\w&.'-]*)(?:\s+[A-Z][\w&.'-]*){0,3})/;
const DECISION_RE =
  /\b(?:decide|decision|should (?:i|we)|whether (?:to|or)|choose between|pick between|which (?:one|option)|go with .{1,40}? or)\b/i;
const I_OWE_RE =
  /\b(?:i (?:promised|committed|owe|told [\w ]{1,30}? i'?d|said i'?d)|i'?ll (?:send|get|call|email|follow up|deliver|drop off))\b/i;
const THEY_OWE_RE =
  /\b([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,2})\s+(?:promised|said (?:he|she|they)'?d|will send|is sending|owes (?:me|us)|agreed to)\b/;
const ACTION_RE =
  /^(?:todo|to do|task|need to|must|remember to|don'?t forget to|call|email|send|buy|order|book|schedule|fix|file|submit|pay|renew|follow up)\b/i;

/** The first meaningful line, stripped of list and checkbox markup. */
export function proposalTitle(content: string): string {
  const line =
    content
      .split("\n")
      .map((l) => l.trim())
      .find(Boolean) ?? "";
  const cleaned = line
    .replace(/^[-*+]\s+/, "")
    .replace(/^\[[ xX]?\]\s*/, "")
    .replace(/^(?:todo|to do|task)\s*[:-]\s*/i, "")
    .trim();
  return cleaned.length > 120 ? `${cleaned.slice(0, 117)}…` : cleaned || "Untitled capture";
}

/**
 * A due date, only when the words actually state one. Relative phrases are
 * read against the day the item was *captured*, not today: "tomorrow" written
 * last Tuesday meant last Wednesday.
 */
export function extractDueDate(
  content: string,
  anchorDay: string
): { date: string; basis: string } | null {
  const text = content.toLowerCase();

  const iso = content.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso) return { date: iso[1], basis: iso[1] };

  if (/\btoday\b|\btonight\b|\beod\b/.test(text)) {
    return { date: anchorDay, basis: "today" };
  }
  if (/\btomorrow\b/.test(text)) {
    return { date: addDaysToDate(anchorDay, 1), basis: "tomorrow" };
  }
  if (/\bnext week\b/.test(text)) {
    return { date: addDaysToDate(anchorDay, 7), basis: "next week" };
  }

  const weekday = text.match(
    /\b(?:by|on|before|this|next|due)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/
  );
  if (weekday) {
    const target = WEEKDAYS.indexOf(weekday[1]);
    const [y, m, d] = anchorDay.split("-").map(Number);
    const current = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    let delta = (target - current + 7) % 7;
    if (delta === 0) delta = 7;
    return { date: addDaysToDate(anchorDay, delta), basis: weekday[0] };
  }

  const monthDay = text.match(
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/
  );
  if (monthDay) {
    const month = MONTHS.indexOf(monthDay[1]);
    const day = Number(monthDay[2]);
    const [anchorYear] = anchorDay.split("-").map(Number);
    if (day >= 1 && day <= 31) {
      let year = anchorYear;
      const candidate = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      // A date more than two months behind the capture almost always means
      // next year ("Jan 5" written in December).
      if (candidate < addDaysToDate(anchorDay, -60)) year += 1;
      const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const probe = new Date(`${date}T00:00:00Z`);
      if (!Number.isNaN(probe.getTime()) && probe.getUTCDate() === day) {
        return { date, basis: monthDay[0] };
      }
    }
  }

  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-word, case-insensitive name match; longest name wins. */
function findByName<T extends { name: string }>(
  content: string,
  candidates: T[],
  caseSensitive = false
): T | null {
  let best: T | null = null;
  for (const candidate of candidates) {
    const name = candidate.name.trim();
    if (name.length < 3) continue;
    const re = new RegExp(`(^|[^\\w])${escapeRegExp(name)}(?=$|[^\\w])`, caseSensitive ? "" : "i");
    if (re.test(content) && (!best || name.length > best.name.length)) {
      best = candidate;
    }
  }
  return best;
}

/** "between A and B" / "A or B?" → the options, when the text names them. */
export function extractOptions(content: string): string[] {
  const between = content.match(/between\s+(.{2,60}?)\s+(?:and|or)\s+(.{2,60}?)(?:[.?!\n]|$)/i);
  if (between) return [between[1].trim(), between[2].trim()];
  const either = content.match(/(?:go with|either)\s+(.{2,60}?)\s+or\s+(.{2,60}?)(?:[.?!\n]|$)/i);
  if (either) return [either[1].trim(), either[2].trim()];
  return [];
}

export function proposeTriage(
  input: TriageInput,
  context: { today: string; projects: TriageProject[]; contacts: TriageContact[] }
): TriageProposal {
  const content = input.content ?? "";
  const anchor = input.capturedAt ? input.capturedAt.slice(0, 10) : context.today;
  const reasons: string[] = [];
  let kind: TriageKind | null = null;
  let direction: OpsDirection | null = null;
  let counterparty: string | null = null;
  let options: string[] = [];

  const type = input.captureType ?? "thought";

  if (type === "link" || type === "quote" || type === "reference") {
    kind = "reference";
    reasons.push(`Captured as a ${type}`);
  }

  if (!kind) {
    const waiting = content.match(WAITING_RE);
    if (waiting) {
      kind = "waiting";
      const rest = content.slice((waiting.index ?? 0) + waiting[0].length);
      counterparty = rest.match(NAME_AFTER_RE)?.[1]?.trim() || null;
      reasons.push(`Says "${waiting[0].trim().slice(0, 60)}"`);
    }
  }

  if (!kind && DECISION_RE.test(content)) {
    kind = "decision";
    options = extractOptions(content);
    reasons.push("Reads as a choice to make");
  }

  if (!kind) {
    // The user's own promise is checked first: "I promised" must not read as
    // a promise made by someone called "I".
    const theyOwe = content.match(THEY_OWE_RE);
    if (I_OWE_RE.test(content)) {
      kind = "commitment";
      direction = "i_owe";
      reasons.push("You made a promise");
    } else if (theyOwe && !/^(?:I|We)$/i.test(theyOwe[1].trim())) {
      kind = "commitment";
      direction = "they_owe";
      counterparty = theyOwe[1].trim();
      reasons.push(`${counterparty} made a promise`);
    }
  }

  if (!kind && type === "followup") {
    kind = "commitment";
    direction = "i_owe";
    reasons.push("Captured as a follow-up");
  }

  if (!kind && (type === "task" || ACTION_RE.test(content.trim()))) {
    kind = "action";
    reasons.push(type === "task" ? "Captured as a task" : "Starts with something to do");
  }

  const confidence: TriageProposal["confidence"] = kind ? "clear" : "unclear";
  if (!kind) {
    kind = "context";
    reasons.push("Nothing in it asks for action — keep as context unless you say otherwise");
  }

  // Contacts are matched case-sensitively: "Will" the person, not "will".
  const contact = counterparty
    ? findByName(counterparty, context.contacts) ?? findByName(content, context.contacts, true)
    : findByName(content, context.contacts, true);
  if (contact && !counterparty) counterparty = contact.name;
  if (contact) reasons.push(`Mentions ${contact.name}`);

  const project =
    findByName(content, context.projects) ??
    (() => {
      const byVenture = context.projects.filter((p) => p.ventureName);
      const venture = findByName(
        content,
        byVenture.map((p) => ({ ...p, name: p.ventureName as string }))
      );
      if (!venture) return null;
      // A venture name alone points at a project only when it has exactly one.
      const members = byVenture.filter((p) => p.ventureName === venture.name);
      return members.length === 1 ? members[0] : null;
    })();
  if (project) reasons.push(`Names ${project.name}`);

  const due =
    kind === "reference" || kind === "context" ? null : extractDueDate(content, anchor);
  if (due) reasons.push(`Date from "${due.basis}"`);

  return {
    kind,
    confidence,
    title: proposalTitle(content),
    dueDate: due?.date ?? null,
    dueBasis: due?.basis ?? null,
    projectId: project?.id ?? null,
    projectName: project?.name ?? null,
    counterparty,
    counterpartyEntityId: contact?.id ?? null,
    direction,
    options,
    reasons,
  };
}
