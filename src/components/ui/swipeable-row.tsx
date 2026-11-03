"use client";

/**
 * SwipeableRow: Apple Mail / Gmail style actions on any row or card.
 *
 * - Swipe **right** for the leading action (Done), **left** for the trailing
 *   ones (Tomorrow, Archive, Delete).
 * - A short swipe opens the row and shows the actions as buttons; a long or
 *   fast swipe commits the first action on that side at once. The colour fills
 *   the row and the icon grows when releasing would commit (plus a tap of
 *   haptics where the device has them).
 * - Vertical drags are left to the page (`touch-action: pan-y`), so lists
 *   still scroll. Opening one row closes any other; scrolling closes it too.
 *
 * Touch and pen only. A mouse drag over text is a selection, not a swipe, so
 * desktop rows keep their visible buttons. Because a swipe is invisible, every
 * swipe action must also be reachable another way (the row's menu or, on a
 * fine pointer, its buttons). That is the rule that keeps this accessible.
 *
 * Thresholds live in `src/lib/gestures/swipe.ts` (pure, unit-tested). During a
 * drag the content moves through refs and data attributes only, so a swipe
 * never re-renders the list it is in.
 */

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  commitProgress,
  dragOffset,
  lockAxis,
  settleSwipe,
  ACTION_WIDTH_PX,
  type SwipeSide,
} from "@/lib/gestures/swipe";

export type SwipeTone = "done" | "later" | "archive" | "danger" | "ask" | "neutral";

export interface SwipeAction {
  id: string;
  label: string;
  icon: LucideIcon;
  tone: SwipeTone;
  onAction: () => void;
}

const TONE: Record<SwipeTone, string> = {
  done: "bg-emerald-600 text-white",
  later: "bg-amber-500 text-white",
  archive: "bg-violet-600 text-white",
  danger: "bg-red-600 text-white",
  ask: "bg-indigo-600 text-white",
  neutral: "bg-slate-500 text-white",
};

const OPEN_EVENT = "bp:swipe-open";
const HINT_KEY = "bp:swipe-hint-seen";
let hintClaimed = false;

interface SwipeableRowProps {
  children: ReactNode;
  leading?: SwipeAction[];
  trailing?: SwipeAction[];
  disabled?: boolean;
  className?: string;
  /** Classes for the moving layer. It must be opaque, or the actions show through. */
  contentClassName?: string;
  /**
   * Let this row play the one-time "you can swipe this" nudge. Pass it to the
   * first row of a list; only one row per device ever plays it.
   */
  hint?: boolean;
  as?: "div" | "li";
}

function vibrate() {
  try {
    navigator.vibrate?.(8);
  } catch {
    /* not supported */
  }
}

export function SwipeableRow({
  children,
  leading = [],
  trailing = [],
  disabled = false,
  className,
  contentClassName = "bg-background",
  hint = false,
  as = "div",
}: SwipeableRowProps) {
  const id = useId();
  const rootRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [openSide, setOpenSide] = useState<SwipeSide | null>(null);

  const gesture = useRef<{
    pointerId: number;
    x: number;
    y: number;
    base: number;
    axis: "x" | "y" | null;
    lastX: number;
    lastT: number;
    velocity: number;
    offset: number;
    armed: boolean;
  } | null>(null);
  const offsetRef = useRef(0);
  const suppressClick = useRef(false);

  const sides = { leadingCount: leading.length, trailingCount: trailing.length };
  const enabled = !disabled && (leading.length > 0 || trailing.length > 0);

  const reducedMotion = () =>
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

  /** Move the content. `animate` springs it; otherwise it tracks the finger. */
  const place = useCallback((offset: number, animate: boolean) => {
    const content = contentRef.current;
    const root = rootRef.current;
    if (!content || !root) return;
    offsetRef.current = offset;
    content.style.transition = animate && !reducedMotion() ? "transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1)" : "none";
    content.style.transform = offset === 0 ? "" : `translate3d(${offset}px,0,0)`;
    root.dataset.side = offset > 0 ? "leading" : offset < 0 ? "trailing" : "";
    const width = root.clientWidth || 1;
    root.style.setProperty("--swipe-progress", String(commitProgress(offset, width)));
  }, []);

  const close = useCallback(() => {
    place(0, true);
    setOpenSide(null);
  }, [place]);

  const run = useCallback(
    (action: SwipeAction, side: SwipeSide) => {
      const root = rootRef.current;
      const width = root?.clientWidth ?? 320;
      if (reducedMotion()) {
        place(0, false);
        setOpenSide(null);
        action.onAction();
        return;
      }
      // Fly out in the swipe's direction, act, then come back. When the action
      // removes the row (most do, optimistically) the return is never seen.
      place(side === "leading" ? width : -width, true);
      window.setTimeout(() => {
        action.onAction();
        window.setTimeout(() => {
          place(0, false);
          setOpenSide(null);
        }, 260);
      }, 180);
    },
    [place]
  );

  // Only one open row at a time, and none once the page scrolls.
  useEffect(() => {
    if (!openSide) return;
    const onOtherOpen = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== id) close();
    };
    const onScroll = () => close();
    window.addEventListener(OPEN_EVENT, onOtherOpen);
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => {
      window.removeEventListener(OPEN_EVENT, onOtherOpen);
      window.removeEventListener("scroll", onScroll, { capture: true });
    };
  }, [openSide, id, close]);

  // The one-time nudge that teaches the gesture.
  useEffect(() => {
    if (!hint || !enabled || hintClaimed) return;
    if (typeof window === "undefined" || !window.matchMedia?.("(pointer: coarse)")?.matches || reducedMotion()) return;
    try {
      if (window.localStorage.getItem(HINT_KEY)) return;
      window.localStorage.setItem(HINT_KEY, "1");
    } catch {
      return;
    }
    hintClaimed = true;
    const peek = trailing.length > 0 ? -ACTION_WIDTH_PX * 0.7 : ACTION_WIDTH_PX * 0.7;
    const t1 = window.setTimeout(() => place(peek, true), 900);
    const t2 = window.setTimeout(() => place(0, true), 1700);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [hint, enabled, trailing.length, place]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!enabled || e.pointerType === "mouse" || !e.isPrimary) return;
    // React bubbles events out of portals (dialogs, menus opened from inside
    // the row) through the component tree; a drag in a dialog is not a swipe.
    if (!(e.currentTarget as HTMLElement).contains(e.target as Node)) return;
    suppressClick.current = false;
    gesture.current = {
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      base: offsetRef.current,
      axis: null,
      lastX: e.clientX,
      lastT: e.timeStamp,
      velocity: 0,
      offset: offsetRef.current,
      armed: false,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g || e.pointerId !== g.pointerId) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (g.axis === null) {
      g.axis = lockAxis(dx, dy);
      if (g.axis === "y") {
        gesture.current = null;
        return;
      }
      if (g.axis === null) return;
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* capture is best-effort */
      }
    }
    const dt = Math.max(1, e.timeStamp - g.lastT);
    g.velocity = 0.8 * ((e.clientX - g.lastX) / dt) + 0.2 * g.velocity;
    g.lastX = e.clientX;
    g.lastT = e.timeStamp;

    const width = rootRef.current?.clientWidth ?? 320;
    const offset = dragOffset(g.base + dx, width, sides);
    g.offset = offset;
    place(offset, false);

    const armed = commitProgress(offset, width) >= 1 && (offset > 0 ? leading.length : trailing.length) > 0;
    if (armed !== g.armed) {
      g.armed = armed;
      if (rootRef.current) rootRef.current.dataset.armed = armed ? "true" : "";
      if (armed) vibrate();
    }
  };

  const finish = (e: React.PointerEvent, cancelled: boolean) => {
    const g = gesture.current;
    if (!g || e.pointerId !== g.pointerId) return;
    gesture.current = null;
    if (rootRef.current) rootRef.current.dataset.armed = "";
    if (g.axis !== "x") return;
    suppressClick.current = true;
    if (cancelled) {
      close();
      return;
    }
    const width = rootRef.current?.clientWidth ?? 320;
    const outcome = settleSwipe({ offset: g.offset, velocity: g.velocity, width, sides, openSide });
    if (outcome.kind === "commit") {
      const action = outcome.side === "leading" ? leading[0] : trailing[0];
      if (action) run(action, outcome.side);
      else close();
    } else if (outcome.kind === "open") {
      place(outcome.offset, true);
      setOpenSide(outcome.side);
      window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }));
    } else {
      close();
    }
  };

  // A drag must never also be a tap, and a tap on an open row only closes it.
  const onClickCapture = (e: React.MouseEvent) => {
    if (!(e.currentTarget as HTMLElement).contains(e.target as Node)) return;
    if (suppressClick.current || openSide) {
      e.preventDefault();
      e.stopPropagation();
      suppressClick.current = false;
      if (openSide) close();
    }
  };

  const panel = (side: SwipeSide, actions: SwipeAction[]) => {
    if (actions.length === 0) return null;
    const isOpen = openSide === side;
    return (
      <div
        aria-hidden={!isOpen}
        inert={!isOpen}
        className={cn(
          "absolute inset-y-0 flex opacity-0 transition-opacity duration-75",
          side === "leading"
            ? "left-0 right-0 justify-start group-data-[side=leading]/swipe:opacity-100"
            : "left-0 right-0 justify-end group-data-[side=trailing]/swipe:opacity-100",
          TONE[actions[0].tone]
        )}
      >
        {(side === "leading" ? actions : [...actions].reverse()).map((action) => {
          const first = action === actions[0];
          const Icon = action.icon;
          return (
            <button
              key={action.id}
              type="button"
              tabIndex={isOpen ? 0 : -1}
              onClick={(e) => {
                e.stopPropagation();
                run(action, side);
              }}
              style={{ minWidth: ACTION_WIDTH_PX }}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 px-2 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white",
                TONE[action.tone],
                first && "group-data-[armed=true]/swipe:grow",
                first && (side === "leading" ? "group-data-[armed=true]/swipe:items-start group-data-[armed=true]/swipe:pl-6" : "group-data-[armed=true]/swipe:items-end group-data-[armed=true]/swipe:pr-6")
              )}
            >
              <Icon
                aria-hidden="true"
                className="h-5 w-5 transition-transform duration-150 group-data-[armed=true]/swipe:scale-125"
              />
              <span>{action.label}</span>
            </button>
          );
        })}
      </div>
    );
  };

  const Root = as;
  return (
    <Root
      ref={rootRef as React.Ref<HTMLDivElement & HTMLLIElement>}
      className={cn("group/swipe relative isolate overflow-hidden", className)}
      data-swipe-open={openSide ?? undefined}
    >
      {panel("leading", leading)}
      {panel("trailing", trailing)}
      <div
        ref={contentRef}
        className={cn("relative z-10 will-change-transform", enabled && "touch-pan-y", contentClassName)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => finish(e, false)}
        onPointerCancel={(e) => finish(e, true)}
        onClickCapture={onClickCapture}
      >
        {children}
      </div>
    </Root>
  );
}
