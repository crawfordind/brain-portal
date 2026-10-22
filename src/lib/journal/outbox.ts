/**
 * The journal's outbox: entries the user has written that the server has not
 * yet confirmed.
 *
 * Before this, an entry lived only in the composer's React state. A failed
 * save left it there, but a refresh, a navigation or a closed tab lost it, and
 * a retry after a lost response wrote it twice. Now an entry is in
 * `localStorage` from the moment Enter is pressed until the server says it is
 * stored, and each one carries its own id, so retrying is always safe.
 *
 * Read through `useSyncExternalStore` (`subscribe` / `getSnapshot`); the
 * server snapshot is empty, so nothing here touches storage during SSR.
 */

export type OutboxStatus = "saving" | "failed";

export interface OutboxEntry {
  /** Sent as `clientId`; becomes the entry's id. */
  id: string;
  date: string;
  text: string;
  status: OutboxStatus;
  error?: string;
  /** Retrying cannot help (e.g. too long); the user must edit it. */
  permanent?: boolean;
  queuedAt: number;
}

const STORAGE_KEY = "bp.journal.outbox.v1";
const EMPTY: OutboxEntry[] = [];

let entries: OutboxEntry[] | null = null;
const listeners = new Set<() => void>();

function load(): OutboxEntry[] {
  if (entries) return entries;
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
    const parsed = raw ? JSON.parse(raw) : [];
    entries = Array.isArray(parsed)
      ? parsed
          .filter(
            (e): e is OutboxEntry =>
              e && typeof e.id === "string" && typeof e.text === "string" && typeof e.date === "string"
          )
          // Anything "saving" when the page closed never heard back.
          .map((e) => (e.status === "saving" ? { ...e, status: "failed" as const } : e))
      : [];
  } catch {
    entries = [];
  }
  return entries;
}

function commit(next: OutboxEntry[]) {
  entries = next;
  try {
    if (next.length) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode or full storage: the in-memory copy still works this visit.
  }
  listeners.forEach((l) => l());
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY) return;
    entries = null; // another tab changed it; re-read
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function getSnapshot(): OutboxEntry[] {
  return load();
}

export function getServerSnapshot(): OutboxEntry[] {
  return EMPTY;
}

export function newEntryId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `j${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

export function enqueue(entry: Pick<OutboxEntry, "id" | "date" | "text">): void {
  const current = load();
  if (current.some((e) => e.id === entry.id)) return;
  commit([...current, { ...entry, status: "saving", queuedAt: Date.now() }]);
}

export function update(id: string, patch: Partial<Omit<OutboxEntry, "id">>): void {
  const current = load();
  if (!current.some((e) => e.id === id)) return;
  commit(current.map((e) => (e.id === id ? { ...e, ...patch } : e)));
}

export function remove(id: string): void {
  const current = load();
  if (!current.some((e) => e.id === id)) return;
  commit(current.filter((e) => e.id !== id));
}

/** Test hook: forget the in-memory copy so the next read hits storage. */
export function __resetForTests(): void {
  entries = null;
  listeners.clear();
}

// ── Composer drafts ──────────────────────────────────────────────────────────
// What is typed but not yet submitted, per day, so a refresh or a tap on
// another page doesn't wipe it.

const DRAFT_PREFIX = "bp.journal.draft.";

export function readDraft(date: string): string {
  try {
    return window.localStorage.getItem(DRAFT_PREFIX + date) ?? "";
  } catch {
    return "";
  }
}

export function writeDraft(date: string, text: string): void {
  try {
    if (text) window.localStorage.setItem(DRAFT_PREFIX + date, text);
    else window.localStorage.removeItem(DRAFT_PREFIX + date);
  } catch {
    // Non-essential.
  }
}
