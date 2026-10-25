/**
 * How each named board colour looks, in both themes.
 *
 * Literal class strings, so Tailwind sees every one. Stickies stay bright in
 * dark mode (as paper notes do); frames and shapes take a tint of the page.
 * SVG strokes use `currentColor`, so the `stroke` class colours them.
 */

import type { BoardColor } from "@/lib/whiteboards/types";

export interface ColorStyle {
  label: string;
  sticky: string;
  shape: string;
  frame: string;
  stroke: string;
  swatch: string;
}

export const COLOR_STYLES: Record<BoardColor, ColorStyle> = {
  yellow: {
    label: "Yellow",
    sticky: "bg-yellow-200 text-yellow-950 dark:bg-yellow-300",
    shape: "bg-yellow-100 border-yellow-500 text-yellow-950 dark:bg-yellow-950/50 dark:border-yellow-400 dark:text-yellow-50",
    frame: "bg-yellow-50/70 border-yellow-300 dark:bg-yellow-950/20 dark:border-yellow-800",
    stroke: "text-yellow-500",
    swatch: "bg-yellow-300",
  },
  orange: {
    label: "Orange",
    sticky: "bg-orange-200 text-orange-950 dark:bg-orange-300",
    shape: "bg-orange-100 border-orange-500 text-orange-950 dark:bg-orange-950/50 dark:border-orange-400 dark:text-orange-50",
    frame: "bg-orange-50/70 border-orange-300 dark:bg-orange-950/20 dark:border-orange-800",
    stroke: "text-orange-500",
    swatch: "bg-orange-300",
  },
  pink: {
    label: "Pink",
    sticky: "bg-pink-200 text-pink-950 dark:bg-pink-300",
    shape: "bg-pink-100 border-pink-500 text-pink-950 dark:bg-pink-950/50 dark:border-pink-400 dark:text-pink-50",
    frame: "bg-pink-50/70 border-pink-300 dark:bg-pink-950/20 dark:border-pink-800",
    stroke: "text-pink-500",
    swatch: "bg-pink-300",
  },
  red: {
    label: "Red",
    sticky: "bg-red-200 text-red-950 dark:bg-red-300",
    shape: "bg-red-100 border-red-500 text-red-950 dark:bg-red-950/50 dark:border-red-400 dark:text-red-50",
    frame: "bg-red-50/70 border-red-300 dark:bg-red-950/20 dark:border-red-800",
    stroke: "text-red-500",
    swatch: "bg-red-400",
  },
  purple: {
    label: "Purple",
    sticky: "bg-purple-200 text-purple-950 dark:bg-purple-300",
    shape: "bg-purple-100 border-purple-500 text-purple-950 dark:bg-purple-950/50 dark:border-purple-400 dark:text-purple-50",
    frame: "bg-purple-50/70 border-purple-300 dark:bg-purple-950/20 dark:border-purple-800",
    stroke: "text-purple-500",
    swatch: "bg-purple-300",
  },
  blue: {
    label: "Blue",
    sticky: "bg-sky-200 text-sky-950 dark:bg-sky-300",
    shape: "bg-sky-100 border-sky-500 text-sky-950 dark:bg-sky-950/50 dark:border-sky-400 dark:text-sky-50",
    frame: "bg-sky-50/70 border-sky-300 dark:bg-sky-950/20 dark:border-sky-800",
    stroke: "text-sky-500",
    swatch: "bg-sky-300",
  },
  teal: {
    label: "Teal",
    sticky: "bg-teal-200 text-teal-950 dark:bg-teal-300",
    shape: "bg-teal-100 border-teal-500 text-teal-950 dark:bg-teal-950/50 dark:border-teal-400 dark:text-teal-50",
    frame: "bg-teal-50/70 border-teal-300 dark:bg-teal-950/20 dark:border-teal-800",
    stroke: "text-teal-500",
    swatch: "bg-teal-300",
  },
  green: {
    label: "Green",
    sticky: "bg-green-200 text-green-950 dark:bg-green-300",
    shape: "bg-green-100 border-green-500 text-green-950 dark:bg-green-950/50 dark:border-green-400 dark:text-green-50",
    frame: "bg-green-50/70 border-green-300 dark:bg-green-950/20 dark:border-green-800",
    stroke: "text-green-500",
    swatch: "bg-green-300",
  },
  gray: {
    label: "Gray",
    sticky: "bg-zinc-200 text-zinc-950 dark:bg-zinc-300",
    shape: "bg-zinc-100 border-zinc-500 text-zinc-950 dark:bg-zinc-800/60 dark:border-zinc-400 dark:text-zinc-50",
    frame: "bg-zinc-50/70 border-zinc-300 dark:bg-zinc-900/30 dark:border-zinc-700",
    stroke: "text-zinc-600 dark:text-zinc-300",
    swatch: "bg-zinc-400",
  },
  white: {
    label: "White",
    sticky: "bg-white text-zinc-950 border border-zinc-200 dark:bg-zinc-100",
    shape: "bg-white border-zinc-400 text-zinc-950 dark:bg-zinc-900 dark:border-zinc-500 dark:text-zinc-50",
    frame: "bg-white/80 border-zinc-300 dark:bg-zinc-900/40 dark:border-zinc-700",
    stroke: "text-zinc-900 dark:text-zinc-100",
    swatch: "bg-white border border-zinc-300",
  },
};
