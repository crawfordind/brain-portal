"use client";

/**
 * Swipe a single card: left, right, up or down. The card follows the finger
 * (damped) and springs back; a decisive swipe calls the matching handler.
 * Touch and pen only, with `touch-action: none` on the card, which the caller
 * applies. Decision rules: `cardSwipe` in `src/lib/gestures/swipe.ts`.
 */

import { useRef } from "react";
import { cardSwipe, type CardSwipe } from "@/lib/gestures/swipe";

export function useCardSwipe(handlers: Partial<Record<Exclude<CardSwipe, null>, () => void>>) {
  const ref = useRef<HTMLDivElement>(null);
  const g = useRef<{ id: number; x: number; y: number; t: number; lx: number; ly: number; vx: number; vy: number; moved: boolean } | null>(null);
  const suppress = useRef(false);

  const place = (dx: number, dy: number, animate: boolean) => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    el.style.transition = animate && !reduce ? "transform 240ms cubic-bezier(0.2,0.8,0.2,1), opacity 240ms" : "none";
    el.style.transform = dx || dy ? `translate3d(${dx}px, ${dy}px, 0) rotate(${dx / 60}deg)` : "";
    el.style.opacity = dx || dy ? String(Math.max(0.55, 1 - Math.hypot(dx, dy) / 400)) : "";
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" || !e.isPrimary) return;
    if (!(e.currentTarget as HTMLElement).contains(e.target as Node)) return;
    suppress.current = false;
    g.current = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, lx: e.clientX, ly: e.clientY, vx: 0, vy: 0, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const s = g.current;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (!s.moved && Math.hypot(dx, dy) > 8) {
      s.moved = true;
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* best-effort */
      }
    }
    const dt = Math.max(1, e.timeStamp - s.t);
    s.vx = (e.clientX - s.lx) / dt;
    s.vy = (e.clientY - s.ly) / dt;
    s.lx = e.clientX;
    s.ly = e.clientY;
    s.t = e.timeStamp;
    // Only show movement in directions that do something.
    const allowX = (dx < 0 && handlers.left) || (dx > 0 && handlers.right);
    const allowY = (dy < 0 && handlers.up) || (dy > 0 && handlers.down);
    if (s.moved) place(allowX ? dx * 0.6 : dx * 0.1, allowY ? dy * 0.6 : dy * 0.1, false);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const s = g.current;
    g.current = null;
    if (!s || s.id !== e.pointerId) return;
    place(0, 0, true);
    if (!s.moved) return;
    suppress.current = true;
    const dir = cardSwipe(e.clientX - s.x, e.clientY - s.y, { x: s.vx, y: s.vy });
    if (dir) handlers[dir]?.();
  };

  const onPointerCancel = () => {
    g.current = null;
    place(0, 0, true);
  };

  /** Stops a swipe's release from also pressing a button under the finger. */
  const onClickCapture = (e: React.MouseEvent) => {
    if (suppress.current) {
      e.preventDefault();
      e.stopPropagation();
      suppress.current = false;
    }
  };

  // A tuple, so the ref and the handlers are separate values: the handlers
  // object can be spread onto the element without reading a ref in render.
  return [ref, { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onClickCapture }] as const;
}
