/**
 * Row density for the stream.
 *
 * The feed used to render one card shape — 88px, icon, title, two-line preview,
 * a metadata row and hover-revealed actions — for a three-minute-old thought, a
 * stale note and an overdue task alike. On a 1080p screen that is about seven
 * items above the fold; on a phone, four. For an app whose premise is a durable
 * copy of every thought, seven is not a lot of thoughts.
 *
 * Density is the user's call, not ours, so this is a control rather than a
 * redesign. Shorter rows are reached by *removing* elements, never by
 * shrinking type below 12px or the hit area below 44px on touch.
 *
 * Pure and import-free so the vocabulary can be unit-tested and shared by the
 * hook, the card and the toggle without dragging anything into the bundle.
 * See docs/plans/2026-09-14-stream-dashboard-v2-design.md, R3.
 */

export const STREAM_DENSITIES = ["compact", "cozy", "comfortable"] as const;

export type StreamDensity = (typeof STREAM_DENSITIES)[number];

/** Where the choice is remembered. */
export const DENSITY_STORAGE_KEY = "bp.stream.density";

/**
 * What the server renders before the stored choice is known.
 *
 * `useSyncExternalStore` needs a stable server snapshot, and this is it. A
 * viewer whose stored choice differs simply re-renders once after hydration —
 * which is why the default is the *common* case rather than the safe one.
 */
export const SERVER_DEFAULT_DENSITY: StreamDensity = "compact";

export const DENSITY_LABELS: Record<
  StreamDensity,
  { label: string; hint: string }
> = {
  compact: { label: "Compact", hint: "One line per item" },
  cozy: { label: "Cozy", hint: "One line plus a preview" },
  comfortable: { label: "Comfortable", hint: "Full cards" },
};

/**
 * Read a stored value back.
 *
 * Returns null — not a default — for anything unrecognised, so the caller
 * decides what absence means. A value written by an older build, or hand-edited
 * in devtools, degrades to "no preference" instead of throwing.
 */
export function parseDensity(
  raw: string | null | undefined
): StreamDensity | null {
  if (!raw) return null;
  return (STREAM_DENSITIES as readonly string[]).includes(raw)
    ? (raw as StreamDensity)
    : null;
}

/**
 * The density to start a viewer on when they have never chosen one.
 *
 * Touch gets `cozy` rather than `compact`: a phone has no hover, so the
 * one-line preview is the only way to recognise a thought you wrote three days
 * ago without opening it. A pointer device gets `compact`, where the extra
 * lines buy less than the extra rows do.
 */
export function defaultDensity(hasCoarsePointer: boolean): StreamDensity {
  return hasCoarsePointer ? "cozy" : "compact";
}

/** Cycle order for a single toggle control (and, later, the `d` shortcut). */
export function nextDensity(current: StreamDensity): StreamDensity {
  const index = STREAM_DENSITIES.indexOf(current);
  return STREAM_DENSITIES[(index + 1) % STREAM_DENSITIES.length];
}
