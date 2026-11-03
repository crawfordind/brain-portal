"use client";

/**
 * SwipeDeck: a row of cards you swipe through, like a carousel of stories.
 *
 * Built on native CSS scroll snapping, so it moves with the finger, flings with
 * the platform's own physics and works with a trackpad's sideways scroll, all
 * without a gesture library. The next card peeks in from the edge, which is
 * what tells a person there is more to swipe to.
 *
 * - Dots under the deck show where you are and jump on tap.
 * - Arrow keys move one card when the deck has focus.
 * - On a mouse screen, previous / next buttons appear (a mouse cannot swipe);
 *   on a touch screen there are none.
 * - `aria-roledescription="carousel"`, and each card says "2 of 5".
 */

import { Children, useCallback, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTouchFirst } from "@/hooks/use-touch-first";

interface SwipeDeckProps {
  /** Names the carousel for assistive tech ("Most important tasks"). */
  label: string;
  children: ReactNode;
  className?: string;
  /** Width of one card. The default leaves the next card peeking on a phone. */
  itemClassName?: string;
}

export function SwipeDeck({
  label,
  children,
  className,
  itemClassName = "basis-[86%] sm:basis-[58%] lg:basis-[calc((100%-1.5rem)/3)]",
}: SwipeDeckProps) {
  const slides = Children.toArray(children);
  const count = slides.length;
  const trackRef = useRef<HTMLDivElement>(null);
  const [rawActive, setActive] = useState(0);
  // Cards can leave the deck (a task gets done); never point past the end.
  const active = Math.max(0, Math.min(rawActive, count - 1));
  const touchFirst = useTouchFirst();

  const onScroll = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const first = track.firstElementChild as HTMLElement | null;
    const step = first ? first.offsetWidth + 12 : track.clientWidth;
    const index = Math.round(track.scrollLeft / Math.max(1, step));
    setActive(Math.max(0, Math.min(count - 1, index)));
  }, [count]);

  const go = (index: number) => {
    const track = trackRef.current;
    const target = track?.children[index] as HTMLElement | undefined;
    if (!track || !target) return;
    track.scrollTo({ left: target.offsetLeft - track.offsetLeft });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      go(Math.min(count - 1, active + 1));
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      go(Math.max(0, active - 1));
    }
  };

  if (count === 0) return null;

  return (
    <section aria-roledescription="carousel" aria-label={label} className={cn("relative", className)}>
      <div
        ref={trackRef}
        tabIndex={0}
        onScroll={onScroll}
        onKeyDown={onKeyDown}
        className="bp-deck -mx-3 flex gap-3 overflow-x-auto px-3 pb-1 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 lg:mx-0 lg:px-0"
      >
        {slides.map((slide, i) => (
          <div
            key={i}
            role="group"
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${count}`}
            className={cn("shrink-0 grow-0", count === 1 ? "basis-full" : itemClassName)}
          >
            {slide}
          </div>
        ))}
      </div>

      {count > 1 && (
        <div className="mt-2 flex items-center justify-center gap-1">
          {!touchFirst && (
            <button
              type="button"
              onClick={() => go(Math.max(0, active - 1))}
              disabled={active === 0}
              className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted disabled:opacity-30"
              aria-label="Previous"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
          {slides.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => go(i)}
              aria-label={`Show ${i + 1} of ${count}`}
              aria-current={i === active ? "true" : undefined}
              // 24px tap area around a small dot.
              className="flex h-6 w-5 items-center justify-center"
            >
              <span
                className={cn(
                  "block h-1.5 rounded-full transition-all duration-200",
                  i === active ? "w-4 bg-primary" : "w-1.5 bg-muted-foreground/30"
                )}
              />
            </button>
          ))}
          {!touchFirst && (
            <button
              type="button"
              onClick={() => go(Math.min(count - 1, active + 1))}
              disabled={active === count - 1}
              className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted disabled:opacity-30"
              aria-label="Next"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          )}
        </div>
      )}
    </section>
  );
}
