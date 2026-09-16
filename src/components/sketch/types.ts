/** Drawing tools available in the sketch pad (OneNote-style). */
export type SketchTool =
  | "pen"
  | "highlighter"
  | "eraser"
  | "line"
  | "rect"
  | "ellipse";

/** A single sampled point along a stroke, with optional pen pressure (0..1). */
export interface SketchPoint {
  x: number;
  y: number;
  /** Pressure from a stylus/pointer, 0..1. Falls back to 0.5 for mouse/touch. */
  p: number;
}

/**
 * A drawn stroke. For freehand tools (pen/highlighter) `points` holds the full
 * sampled path. For shape tools (line/rect/ellipse) only the first and last
 * points are meaningful (start + current end).
 */
export interface SketchStroke {
  tool: SketchTool;
  color: string;
  /** Base stroke width in CSS pixels. */
  size: number;
  /** 0..1 alpha. Highlighter uses a low value. */
  opacity: number;
  points: SketchPoint[];
}

/** Background guide rendered behind strokes. */
export type SketchBackground = "blank" | "grid" | "ruled";

/** Imperative handle exposed by the SketchPad component. */
export interface SketchPadHandle {
  /** Export the current drawing as a white-background PNG data URL (no guides). */
  exportPNG: () => string | null;
  /** Raw stroke data, for persistence / later re-editing. */
  getStrokes: () => SketchStroke[];
  /** True when nothing has been drawn yet. */
  isEmpty: () => boolean;
  clear: () => void;
}
