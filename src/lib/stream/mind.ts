/**
 * The Mind map: what matters most, in this moment, today, and in life.
 *
 * The dashboard's stream used to be a chronological list, which ranks by the
 * one property that says least about importance: when a row was last touched.
 * This module ranks the same items by *how much they need the user now*, then
 * lays them out as a small neural network:
 *
 *   - **Moment**: the single most important item, at the centre.
 *   - **Today**: the next few, on a close inner shell around it.
 *   - **Life**: everything else, further out, gathered around the project
 *     each belongs to. Projects are the hubs of the network.
 *
 * People live here too. Contacts with a follow-up due, a capture to sort, or a
 * recent conversation are drawn as `person` items gathered around their own
 * "People" hub, so the CRM is part of the same picture rather than a card
 * beside it.
 *
 * Connections mean something. An item links to its project hub, items written
 * by the same run link to each other, and items sharing a tag link to each
 * other. Only items with none of those get a quiet "ambient" link to their
 * nearest neighbour, so nothing floats alone.
 *
 * Pure and deterministic: positions come from a hash of each id, so the same
 * items always draw the same brain, and nothing here touches the DOM, WebGL
 * or the database. Unit-tested in tests/lib/stream/mind.test.ts.
 */

import { parseDbTimestamp } from "./grouping";

/** The subset of a stream row the map needs. */
export interface MindSourceItem {
  id: string;
  type: string;
  status: string;
  title: string;
  content?: string | null;
  priority?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  projectColor?: string | null;
  tags?: string[] | null;
  dueDate?: string | null;
  agentTaskId?: string | null;
  agentStatus?: string | null;
  sourceRunId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type MindRing = "moment" | "today" | "life";

export interface MindScore {
  score: number;
  /** One short phrase saying why this item is where it is. */
  reason: string;
}

export interface MindNode {
  /** Unique within the graph. Items use their stream id; hubs `hub:<projectId>`. */
  key: string;
  kind: "item" | "hub";
  ring: MindRing | "hub";
  /** Importance order among items, 0 = the moment. Hubs are -1. */
  rank: number;
  item?: MindSourceItem;
  label: string;
  reason: string;
  score: number;
  /** Relative size, 0..1. */
  weight: number;
  /** Hex colour, e.g. "#f2b45a". */
  color: string;
  position: [number, number, number];
}

export interface MindEdge {
  from: string;
  to: string;
  kind: "project" | "run" | "tag" | "focus" | "ambient";
  /** 0..1, how visible the connection is. */
  strength: number;
}

export interface MindGraph {
  nodes: MindNode[];
  edges: MindEdge[];
  /** Item nodes in importance order (no hubs). */
  ranked: MindNode[];
  /** Key of the moment node, or null when there is nothing to show. */
  focusKey: string | null;
}

export interface BuildMindOptions {
  now: Date;
  /** Upper bound on how many items are drawn. Defaults to 48. */
  maxItems?: number;
  /** How many items sit on the Today shell. Defaults to 6. */
  todayCount?: number;
  /** Items written after this instant count as new. */
  lastVisitAt?: Date | null;
}

/* ------------------------------------------------------------------------ */
/* Colour                                                                    */
/* ------------------------------------------------------------------------ */

/**
 * One colour per kind of thing, chosen to sit together calmly: no two
 * neighbours are both saturated, and the moment's own warm glow is drawn by
 * the scene rather than by this table.
 */
export const MIND_TYPE_COLORS: Record<string, string> = {
  task: "#f2b45a", // amber
  reminder: "#f08a8a", // rose
  decision: "#e9a06b", // apricot
  question: "#c79bf2", // lilac
  thought: "#a99cf7", // soft violet
  capture: "#a99cf7",
  note: "#7cc4f2", // sky
  journal: "#86d4a8", // sage
  reference: "#9fb4c8", // slate
  insight: "#f5d77a", // pale gold
  agent_output: "#6fd6cf", // teal
  person: "#ef9fd0", // orchid
};

/** Key of the hub that gathers the user's people. */
export const PEOPLE_HUB_KEY = "hub:people";

export const MIND_HUB_COLOR = "#b8c4e0";

export function colorForType(type: string): string {
  return MIND_TYPE_COLORS[type] ?? "#a9b4c8";
}

/** A short human word for a stream type. */
export function labelForType(type: string): string {
  switch (type) {
    case "agent_output":
      return "AI work";
    case "capture":
    case "thought":
      return "Thought";
    case "person":
      return "Person";
    default:
      return type.charAt(0).toUpperCase() + type.slice(1);
  }
}

/* ------------------------------------------------------------------------ */
/* Scoring                                                                   */
/* ------------------------------------------------------------------------ */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const PRIORITY_WEIGHT: Record<string, number> = {
  urgent: 30,
  high: 18,
  medium: 6,
  low: 0,
};

const TYPE_WEIGHT: Record<string, number> = {
  decision: 10,
  task: 8,
  reminder: 8,
  question: 5,
  agent_output: 4,
  thought: 3,
  capture: 3,
  insight: 2,
  note: 0,
  reference: -2,
  journal: -6,
  person: 2,
};

/** `YYYY-MM-DD` for the viewer's own calendar day. */
export function localDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Whole calendar days from `a` to `b` (both `YYYY-MM-DD`). */
function dayDiff(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const ua = Date.UTC(ay, am - 1, ad);
  const ub = Date.UTC(by, bm - 1, bd);
  return Math.round((ub - ua) / DAY_MS);
}

interface DueInfo {
  /** Calendar days from today to the due day: negative = overdue. */
  days: number;
  /** Set when the due value carried a time, e.g. a reminder. */
  at: Date | null;
}

/**
 * Read a due value. A bare `YYYY-MM-DD` is a calendar day, compared as one, so
 * a task due today is not overdue at 09:00 because UTC midnight has passed. A
 * value with a time is an instant (reminders), read with `parseDbTimestamp`.
 */
export function readDue(raw: string | null | undefined, now: Date): DueInfo | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const today = localDayKey(now);

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return { days: dayDiff(today, trimmed), at: null };
  }

  const at = parseDbTimestamp(trimmed);
  if (!at) return null;
  return { days: dayDiff(today, localDayKey(at)), at };
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * How much an item needs the user right now, and why.
 *
 * Each signal adds to the score and offers a reason; the reason shown is the
 * strongest signal's, so the sentence always explains the placement.
 */
export function scoreMindItem(
  item: MindSourceItem,
  now: Date,
  lastVisitAt?: Date | null
): MindScore {
  const signals: Array<{ weight: number; reason: string }> = [];
  const type = item.type;
  const status = item.status;

  if (status === "completed" || status === "archived") {
    return { score: -100, reason: "Done" };
  }

  if (type === "person") return scorePerson(item, now);

  // Something is waiting on the user's say-so.
  if (status === "waiting") {
    signals.push({
      weight: 62,
      reason: type === "agent_output" ? "Ready for your review" : "Waiting for you",
    });
  }

  // Dates. Only things the user does have a due date that means "act".
  const due = readDue(item.dueDate, now);
  if (due && (type === "task" || type === "reminder" || type === "decision")) {
    if (due.at && type === "reminder") {
      const minutes = Math.round((due.at.getTime() - now.getTime()) / 60000);
      if (minutes <= 0) {
        signals.push({ weight: 74, reason: "Reminder is due" });
      } else if (minutes <= 120) {
        signals.push({ weight: 66 - minutes / 6, reason: `Reminder in ${plural(minutes, "minute")}` });
      }
    }
    if (due.days < 0) {
      const late = -due.days;
      signals.push({
        weight: 68 + Math.min(late, 14) * 1.5,
        reason: `Overdue by ${plural(late, "day")}`,
      });
    } else if (due.days === 0) {
      signals.push({ weight: 58, reason: "Due today" });
    } else if (due.days === 1) {
      signals.push({ weight: 34, reason: "Due tomorrow" });
    } else if (due.days <= 7) {
      signals.push({ weight: 26 - due.days * 2, reason: `Due in ${plural(due.days, "day")}` });
    }
  }

  const priority = PRIORITY_WEIGHT[item.priority ?? ""] ?? 0;
  if (priority > 0) {
    signals.push({
      weight: priority,
      reason: item.priority === "urgent" ? "Marked urgent" : item.priority === "high" ? "High priority" : "Open",
    });
  }

  // Fresh captures are what is on the user's mind right now. Decays over about
  // half a day, so this morning's thought still glows at lunch.
  const created = parseDbTimestamp(item.createdAt);
  if (created) {
    const ageHours = Math.max(0, (now.getTime() - created.getTime()) / HOUR_MS);
    const fresh = 22 * Math.exp(-ageHours / 10);
    if (fresh > 1) {
      signals.push({
        weight: fresh,
        reason: ageHours < 1 ? "Just captured" : ageHours < 12 ? "On your mind today" : "Recent",
      });
    }
    if (lastVisitAt && created.getTime() > lastVisitAt.getTime()) {
      signals.push({ weight: 5, reason: "New since your last visit" });
    }
  }

  // An agent is busy on it: nothing for the user to do yet.
  const busy = status === "processing" ? -6 : 0;
  const typeWeight = TYPE_WEIGHT[type] ?? 0;

  const score =
    signals.reduce((sum, s) => sum + s.weight, 0) + busy + typeWeight;

  const strongest = signals.reduce<{ weight: number; reason: string } | null>(
    (best, s) => (best === null || s.weight > best.weight ? s : best),
    null
  );

  let reason = strongest?.reason ?? "Part of your bigger picture";
  if (status === "processing" && (!strongest || strongest.weight < 30)) {
    reason = "Being worked on";
  }

  return { score: Math.round(score * 10) / 10, reason };
}

/**
 * A person earns a place for one of three reasons: a follow-up whose date has
 * arrived (`dueDate`), a capture waiting to be sorted (`status: "waiting"`),
 * or a recent conversation (`createdAt` is the last touch). A conversation
 * glows for about a week, not half a day: people move slower than thoughts.
 */
function scorePerson(item: MindSourceItem, now: Date): MindScore {
  const typeWeight = TYPE_WEIGHT.person;
  const due = readDue(item.dueDate, now);
  if (due && due.days <= 0) {
    const late = -due.days;
    return {
      score: Math.round((60 + Math.min(late, 14) * 1.2 + typeWeight) * 10) / 10,
      reason: late > 0 ? `Follow-up ${plural(late, "day")} late` : "Follow-up due",
    };
  }
  if (item.status === "waiting") {
    return { score: 40 + typeWeight, reason: "Needs sorting" };
  }
  const touched = parseDbTimestamp(item.createdAt);
  const days = touched ? Math.max(0, (now.getTime() - touched.getTime()) / DAY_MS) : 30;
  const warmth = 14 * Math.exp(-days / 7);
  return {
    score: Math.round((warmth + typeWeight) * 10) / 10,
    reason: days < 1 ? "Spoke today" : days < 8 ? "Spoke recently" : "In your circle",
  };
}

/* ------------------------------------------------------------------------ */
/* Deterministic randomness                                                  */
/* ------------------------------------------------------------------------ */

/** FNV-1a: a stable 32-bit hash of a string. */
export function hashString(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A small seeded PRNG (mulberry32), so layout is the same on every render. */
function seeded(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Point `i` of `n` spread evenly over a unit sphere (Fibonacci lattice). */
function fibonacciPoint(i: number, n: number): [number, number, number] {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const y = n === 1 ? 0 : 1 - (i / (n - 1)) * 2;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = golden * i;
  return [Math.cos(theta) * r, y, Math.sin(theta) * r];
}

/**
 * The network is drawn inside a gently brain-shaped ellipsoid: wider than it
 * is tall, a little deeper than tall. Subtle enough to read as organic rather
 * than as an anatomical model.
 */
const BRAIN_SHAPE: [number, number, number] = [1.28, 0.86, 1.02];

function shape(p: [number, number, number], radius: number): [number, number, number] {
  return [p[0] * radius * BRAIN_SHAPE[0], p[1] * radius * BRAIN_SHAPE[1], p[2] * radius * BRAIN_SHAPE[2]];
}

function distance(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/* ------------------------------------------------------------------------ */
/* Graph                                                                     */
/* ------------------------------------------------------------------------ */

export const TODAY_RADIUS = 2.1;
export const LIFE_RADIUS = 4.2;

/** Most project hubs drawn; further projects' items float free. */
const MAX_HUBS = 8;
/** Most tag links one item makes, so a common tag does not wire everything. */
const MAX_TAG_LINKS_PER_ITEM = 2;

function itemKey(item: MindSourceItem): string {
  return `${item.type}:${item.id}`;
}

/**
 * Rank items and lay them out as a network.
 *
 * Done and archived items are left out: the map is about what is alive.
 * Duplicates (the same id fetched by two queries) are dropped.
 */
export function buildMindGraph(
  items: MindSourceItem[],
  options: BuildMindOptions
): MindGraph {
  const { now, lastVisitAt = null } = options;
  const maxItems = options.maxItems ?? 48;
  const todayCount = options.todayCount ?? 6;

  const seen = new Set<string>();
  const scored: Array<{ item: MindSourceItem; key: string } & MindScore> = [];

  for (const item of items) {
    if (item.status === "completed" || item.status === "archived") continue;
    const key = itemKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    scored.push({ item, key, ...scoreMindItem(item, now, lastVisitAt) });
  }

  // Highest score first; ties go to the most recently touched, then the id,
  // so the order is total and stable.
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const at = parseDbTimestamp(a.item.updatedAt)?.getTime() ?? 0;
    const bt = parseDbTimestamp(b.item.updatedAt)?.getTime() ?? 0;
    if (bt !== at) return bt - at;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });

  const kept = scored.slice(0, maxItems);
  if (kept.length === 0) {
    return { nodes: [], edges: [], ranked: [], focusKey: null };
  }

  const maxScore = Math.max(...kept.map((s) => s.score), 1);
  const minScore = Math.min(...kept.map((s) => s.score));
  const span = Math.max(1, maxScore - minScore);

  /* ---- Hubs: the projects (and people) the life ring gathers around. --- */
  const projectCounts = new Map<string, { name: string; color: string | null; count: number }>();
  let peopleCount = 0;
  kept.forEach((s, index) => {
    if (index === 0) return;
    if (s.item.type === "person") {
      peopleCount += 1;
      return;
    }
    const pid = s.item.projectId;
    if (!pid) return;
    const entry = projectCounts.get(pid) ?? {
      name: s.item.projectName || "Project",
      color: s.item.projectColor ?? null,
      count: 0,
    };
    entry.count += 1;
    projectCounts.set(pid, entry);
  });

  const hubIds = [...projectCounts.entries()]
    .sort((a, b) => b[1].count - a[1].count || (a[0] < b[0] ? -1 : 1))
    .slice(0, peopleCount > 0 ? MAX_HUBS - 1 : MAX_HUBS)
    .map(([id]) => id);

  const hubInfos = hubIds.map((pid) => ({ key: `hub:${pid}`, ...projectCounts.get(pid)! }));
  if (peopleCount > 0) {
    hubInfos.push({ key: PEOPLE_HUB_KEY, name: "People", color: MIND_TYPE_COLORS.person, count: peopleCount });
  }

  const hubNodes: MindNode[] = hubInfos.map((info, i) => {
    const rand = seeded(hashString(info.key));
    // Hubs ring the brain around its middle, evenly spaced and gently tilted,
    // rather than on a sphere: two projects on a sphere sit at the poles,
    // which draws a dumbbell, not a mind.
    const angle = (i / hubInfos.length) * Math.PI * 2 + 0.6 + (rand() - 0.5) * 0.35;
    const lift = (i % 2 === 0 ? 1 : -1) * (0.18 + rand() * 0.22);
    const jitter: [number, number, number] = [Math.cos(angle), lift, Math.sin(angle)];
    const len = Math.hypot(...jitter) || 1;
    return {
      key: info.key,
      kind: "hub",
      ring: "hub",
      rank: -1,
      label: info.name,
      reason:
        info.key === PEOPLE_HUB_KEY
          ? `${info.count} ${info.count === 1 ? "person" : "people"} on your mind`
          : plural(info.count, "thing") + " in this project",
      score: 0,
      weight: Math.min(1, 0.45 + info.count * 0.06),
      color: info.color && /^#[0-9a-f]{6}$/i.test(info.color) ? info.color : MIND_HUB_COLOR,
      position: shape(
        [jitter[0] / len, jitter[1] / len, jitter[2] / len],
        LIFE_RADIUS * 1.05
      ),
    };
  });
  const hubByProject = new Map(hubIds.map((pid, i) => [pid, hubNodes[i]]));
  const peopleHub = hubNodes.find((h) => h.key === PEOPLE_HUB_KEY);
  const hubFor = (item: MindSourceItem): MindNode | undefined =>
    item.type === "person" ? peopleHub : item.projectId ? hubByProject.get(item.projectId) : undefined;

  /* ---- Items. ---------------------------------------------------------- */
  const todayTotal = Math.min(todayCount, Math.max(0, kept.length - 1));

  const itemNodes: MindNode[] = kept.map((s, rank) => {
    const rand = seeded(hashString(s.key));
    const ring: MindRing = rank === 0 ? "moment" : rank <= todayTotal ? "today" : "life";
    const normalized = (s.score - minScore) / span;

    let position: [number, number, number];
    if (ring === "moment") {
      position = [0, 0, 0];
    } else if (ring === "today") {
      const p = fibonacciPoint(rank - 1, Math.max(todayTotal, 2));
      const r = TODAY_RADIUS * (0.92 + rand() * 0.16);
      position = shape(p, r);
    } else {
      const hub = hubFor(s.item);
      if (hub) {
        // Gather around the project, on the side facing the centre.
        const spread = 1.15;
        const offset: [number, number, number] = [
          (rand() - 0.5) * 2 * spread,
          (rand() - 0.5) * 2 * spread,
          (rand() - 0.5) * 2 * spread,
        ];
        const pull = 0.82 + rand() * 0.1;
        position = [
          hub.position[0] * pull + offset[0],
          hub.position[1] * pull + offset[1] * 0.8,
          hub.position[2] * pull + offset[2],
        ];
      } else {
        const lifeIndex = rank - todayTotal - 1;
        const lifeTotal = Math.max(kept.length - todayTotal - 1, 2);
        const p = fibonacciPoint(lifeIndex, lifeTotal);
        const r = LIFE_RADIUS * (0.72 + rand() * 0.4);
        position = shape(p, r);
      }
    }

    return {
      key: s.key,
      kind: "item",
      ring,
      rank,
      item: s.item,
      label: s.item.title?.trim() || labelForType(s.item.type),
      reason: s.reason,
      score: s.score,
      weight: ring === "moment" ? 1 : 0.25 + normalized * 0.6,
      color: colorForType(s.item.type),
      position,
    };
  });

  /* ---- Edges. ---------------------------------------------------------- */
  const edges: MindEdge[] = [];
  const linked = new Set<string>();
  const edgeIds = new Set<string>();

  const addEdge = (from: string, to: string, kind: MindEdge["kind"], strength: number) => {
    if (from === to) return;
    const id = from < to ? `${from}|${to}` : `${to}|${from}`;
    if (edgeIds.has(id)) return;
    edgeIds.add(id);
    edges.push({ from, to, kind, strength });
    linked.add(from);
    linked.add(to);
  };

  const focus = itemNodes[0];

  // The moment reaches out to everything on today's shell.
  for (const node of itemNodes) {
    if (node.ring === "today") addEdge(focus.key, node.key, "focus", 0.55);
  }

  // Items to their project, people to the People hub.
  for (const node of itemNodes) {
    const hub = node.item ? hubFor(node.item) : undefined;
    if (hub) addEdge(node.key, hub.key, "project", node.ring === "life" ? 0.4 : 0.5);
  }

  // One job's rows belong together.
  const byRun = new Map<string, MindNode[]>();
  for (const node of itemNodes) {
    const run = node.item?.sourceRunId;
    if (!run) continue;
    const group = byRun.get(run) ?? [];
    group.push(node);
    byRun.set(run, group);
  }
  for (const group of byRun.values()) {
    for (let i = 1; i < group.length; i++) addEdge(group[i - 1].key, group[i].key, "run", 0.35);
  }

  // Shared tags, capped per item so one popular tag does not wire everything.
  const tagLinks = new Map<string, number>();
  for (let i = 0; i < itemNodes.length; i++) {
    const a = itemNodes[i];
    const aTags = new Set((a.item?.tags ?? []).map((t) => t.toLowerCase()));
    if (aTags.size === 0) continue;
    for (let j = i + 1; j < itemNodes.length; j++) {
      const b = itemNodes[j];
      if ((tagLinks.get(a.key) ?? 0) >= MAX_TAG_LINKS_PER_ITEM) break;
      if ((tagLinks.get(b.key) ?? 0) >= MAX_TAG_LINKS_PER_ITEM) continue;
      const shared = (b.item?.tags ?? []).some((t) => aTags.has(t.toLowerCase()));
      if (!shared) continue;
      addEdge(a.key, b.key, "tag", 0.3);
      tagLinks.set(a.key, (tagLinks.get(a.key) ?? 0) + 1);
      tagLinks.set(b.key, (tagLinks.get(b.key) ?? 0) + 1);
    }
  }

  // Nothing floats alone: an unconnected node gets a faint link to its
  // nearest neighbour, which is what makes the whole read as one network.
  const all = [...itemNodes, ...hubNodes];
  for (const node of all) {
    if (linked.has(node.key) || all.length < 2) continue;
    let nearest: MindNode | null = null;
    let best = Infinity;
    for (const other of all) {
      if (other.key === node.key) continue;
      const d = distance(node.position, other.position);
      if (d < best) {
        best = d;
        nearest = other;
      }
    }
    if (nearest) addEdge(node.key, nearest.key, "ambient", 0.18);
  }

  return {
    nodes: [...itemNodes, ...hubNodes],
    edges,
    ranked: itemNodes,
    focusKey: focus.key,
  };
}
