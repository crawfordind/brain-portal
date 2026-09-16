/**
 * Local dismissal state for system-health issues.
 *
 * Dismissal is intentionally client-side and per-signature: it hides an issue
 * the user has already read and reported, but a *newer* occurrence of the same
 * problem comes back. There is no "mark resolved" here — the only real way to
 * clear an issue is to fix its cause, at which point the probe stops reporting
 * it and the header icon disappears on its own.
 */

import type { SystemIssue } from "@/lib/system-health/types";

export const DISMISSED_STORAGE_KEY = "bp:system-health:dismissed";

/** Dismissals older than this expire, so a recurring problem resurfaces. */
const DISMISSAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** signature → ISO timestamp of the occurrence that was dismissed. */
export type DismissalMap = Record<string, string>;

export function readDismissed(): DismissalMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(DISMISSED_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    const cutoff = Date.now() - DISMISSAL_TTL_MS;
    const map: DismissalMap = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value !== "string") continue;
      const at = Date.parse(value);
      if (Number.isNaN(at) || at < cutoff) continue;
      map[key] = value;
    }
    return map;
  } catch {
    return {};
  }
}

export function writeDismissed(map: DismissalMap): DismissalMap {
  if (typeof window === "undefined") return map;
  try {
    window.localStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Private mode / quota — dismissal just doesn't persist.
  }
  return map;
}

export function dismissIssue(issue: SystemIssue, current: DismissalMap): DismissalMap {
  return writeDismissed({
    ...current,
    [issue.signature]: new Date().toISOString(),
  });
}

export function isDismissed(issue: SystemIssue, dismissed: DismissalMap): boolean {
  return Boolean(dismissed[issue.signature]);
}
