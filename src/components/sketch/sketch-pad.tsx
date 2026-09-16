"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  Pencil,
  Highlighter,
  Eraser,
  Minus,
  Square,
  Circle,
  Undo2,
  Redo2,
  Trash2,
  Grid3x3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type {
  SketchBackground,
  SketchPadHandle,
  SketchPoint,
  SketchStroke,
  SketchTool,
} from "./types";

const PALETTE = [
  "#0f172a", // ink
  "#ef4444", // red
  "#2563eb", // blue
  "#16a34a", // green
  "#f59e0b", // amber
  "#9333ea", // purple
];

const HIGHLIGHTER_OPACITY = 0.35;
const HIGHLIGHTER_SCALE = 4; // highlighter is much wider than its nominal size
const ERASER_RADIUS_SCALE = 4;

interface SketchPadProps {
  className?: string;
}

/** Map a pointer event to canvas-local CSS pixel coordinates + pressure. */
function pointFromEvent(
  canvas: HTMLCanvasElement,
  e: React.PointerEvent
): SketchPoint {
  const rect = canvas.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
    p: e.pressure > 0 ? e.pressure : 0.5,
  };
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

/** Draw the guide background (grid / ruled lines). */
function drawBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  background: SketchBackground
) {
  if (background === "blank") return;
  ctx.save();
  ctx.strokeStyle = "rgba(100, 116, 139, 0.25)";
  ctx.lineWidth = 1;
  const gap = 28;
  ctx.beginPath();
  for (let y = gap; y < height; y += gap) {
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  if (background === "grid") {
    for (let x = gap; x < width; x += gap) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
  }
  ctx.stroke();
  ctx.restore();
}

/** Render a single stroke onto a context whose units are CSS pixels. */
function drawStroke(ctx: CanvasRenderingContext2D, stroke: SketchStroke) {
  const { points, tool, color, size, opacity } = stroke;
  if (points.length === 0) return;

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (tool === "line") {
    const a = points[0];
    const b = points[points.length - 1];
    ctx.lineWidth = size;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  } else if (tool === "rect") {
    const a = points[0];
    const b = points[points.length - 1];
    ctx.lineWidth = size;
    ctx.strokeRect(
      Math.min(a.x, b.x),
      Math.min(a.y, b.y),
      Math.abs(b.x - a.x),
      Math.abs(b.y - a.y)
    );
  } else if (tool === "ellipse") {
    const a = points[0];
    const b = points[points.length - 1];
    ctx.lineWidth = size;
    ctx.beginPath();
    ctx.ellipse(
      (a.x + b.x) / 2,
      (a.y + b.y) / 2,
      Math.abs(b.x - a.x) / 2,
      Math.abs(b.y - a.y) / 2,
      0,
      0,
      Math.PI * 2
    );
    ctx.stroke();
  } else {
    // Freehand pen / highlighter.
    if (points.length === 1) {
      const pt = points[0];
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, size / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1];
        const b = points[i];
        // Pen varies width with pressure; highlighter stays constant.
        const width =
          tool === "pen" ? size * (0.5 + 0.5 * ((a.p + b.p) / 2)) : size;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

export const SketchPad = forwardRef<SketchPadHandle, SketchPadProps>(
  function SketchPad({ className }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const strokesRef = useRef<SketchStroke[]>([]);
    const redoRef = useRef<SketchStroke[]>([]);
    const currentRef = useRef<SketchStroke | null>(null);
    const drawingRef = useRef(false);

    const [tool, setTool] = useState<SketchTool>("pen");
    const [color, setColor] = useState(PALETTE[0]);
    const [size, setSize] = useState(3);
    const [background, setBackground] = useState<SketchBackground>("grid");
    // Mirror the live history sizes so undo/redo/clear buttons stay in sync
    // without reading mutable refs during render.
    const [strokeCount, setStrokeCount] = useState(0);
    const [redoCount, setRedoCount] = useState(0);

    // Mirror reactive settings into refs so the long-lived render() and pointer
    // handlers can read the latest values without being recreated.
    const toolRef = useRef(tool);
    const colorRef = useRef(color);
    const sizeRef = useRef(size);
    const bgRef = useRef(background);
    useEffect(() => {
      toolRef.current = tool;
    }, [tool]);
    useEffect(() => {
      colorRef.current = color;
    }, [color]);
    useEffect(() => {
      sizeRef.current = size;
    }, [size]);
    useEffect(() => {
      bgRef.current = background;
    }, [background]);

    const syncCounts = useCallback(() => {
      setStrokeCount(strokesRef.current.length);
      setRedoCount(redoRef.current.length);
    }, []);

    const cssSize = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return { w: 0, h: 0 };
      const dpr = window.devicePixelRatio || 1;
      return { w: canvas.width / dpr, h: canvas.height / dpr };
    }, []);

    const render = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const { w, h } = cssSize();

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      drawBackground(ctx, w, h, bgRef.current);

      for (const stroke of strokesRef.current) drawStroke(ctx, stroke);
      if (currentRef.current) drawStroke(ctx, currentRef.current);
    }, [cssSize]);

    // Size the backing store to the container (handling high-DPI displays).
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const parent = canvas.parentElement;
      if (!parent) return;

      const resize = () => {
        const dpr = window.devicePixelRatio || 1;
        const rect = parent.getBoundingClientRect();
        canvas.width = Math.max(1, Math.round(rect.width * dpr));
        canvas.height = Math.max(1, Math.round(rect.height * dpr));
        canvas.style.width = `${rect.width}px`;
        canvas.style.height = `${rect.height}px`;
        render();
      };

      resize();
      const observer = new ResizeObserver(resize);
      observer.observe(parent);
      return () => observer.disconnect();
    }, [render]);

    useEffect(() => {
      render();
    }, [render, background]);

    const eraseAt = useCallback((pt: SketchPoint) => {
      const threshold = sizeRef.current * ERASER_RADIUS_SCALE;
      const before = strokesRef.current.length;
      strokesRef.current = strokesRef.current.filter((stroke) => {
        return !stroke.points.some((p) => dist(p.x, p.y, pt.x, pt.y) <= threshold);
      });
      return strokesRef.current.length !== before;
    }, []);

    const handlePointerDown = useCallback(
      (e: React.PointerEvent) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.setPointerCapture(e.pointerId);
        drawingRef.current = true;
        redoRef.current = [];
        const pt = pointFromEvent(canvas, e);

        if (toolRef.current === "eraser") {
          if (eraseAt(pt)) {
            syncCounts();
            render();
          }
          return;
        }

        const isHighlighter = toolRef.current === "highlighter";
        currentRef.current = {
          tool: toolRef.current,
          color: colorRef.current,
          size: isHighlighter ? sizeRef.current * HIGHLIGHTER_SCALE : sizeRef.current,
          opacity: isHighlighter ? HIGHLIGHTER_OPACITY : 1,
          points: [pt],
        };
        render();
      },
      [eraseAt, render, syncCounts]
    );

    const handlePointerMove = useCallback(
      (e: React.PointerEvent) => {
        if (!drawingRef.current) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const pt = pointFromEvent(canvas, e);

        if (toolRef.current === "eraser") {
          if (eraseAt(pt)) {
            syncCounts();
            render();
          }
          return;
        }

        const stroke = currentRef.current;
        if (!stroke) return;
        if (stroke.tool === "pen" || stroke.tool === "highlighter") {
          stroke.points.push(pt);
        } else {
          // Shapes: keep just start + current end.
          stroke.points = [stroke.points[0], pt];
        }
        render();
      },
      [eraseAt, render, syncCounts]
    );

    const endStroke = useCallback(() => {
      if (!drawingRef.current) return;
      drawingRef.current = false;
      const stroke = currentRef.current;
      currentRef.current = null;
      if (stroke && stroke.points.length > 0) {
        strokesRef.current = [...strokesRef.current, stroke];
        syncCounts();
      }
      render();
    }, [render, syncCounts]);

    const undo = useCallback(() => {
      const strokes = strokesRef.current;
      if (strokes.length === 0) return;
      redoRef.current = [...redoRef.current, strokes[strokes.length - 1]];
      strokesRef.current = strokes.slice(0, -1);
      syncCounts();
      render();
    }, [render, syncCounts]);

    const redo = useCallback(() => {
      const redos = redoRef.current;
      if (redos.length === 0) return;
      strokesRef.current = [...strokesRef.current, redos[redos.length - 1]];
      redoRef.current = redos.slice(0, -1);
      syncCounts();
      render();
    }, [render, syncCounts]);

    const clear = useCallback(() => {
      if (strokesRef.current.length === 0) return;
      redoRef.current = [];
      strokesRef.current = [];
      syncCounts();
      render();
    }, [render, syncCounts]);

    useImperativeHandle(
      ref,
      (): SketchPadHandle => ({
        getStrokes: () => strokesRef.current,
        isEmpty: () => strokesRef.current.length === 0,
        clear,
        exportPNG: () => {
          const { w, h } = cssSize();
          if (w === 0 || h === 0) return null;
          // Render at 2x CSS resolution on a white background (no guides) so
          // the OCR model sees clean, high-contrast ink.
          const scale = 2;
          const out = document.createElement("canvas");
          out.width = Math.round(w * scale);
          out.height = Math.round(h * scale);
          const ctx = out.getContext("2d");
          if (!ctx) return null;
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, out.width, out.height);
          ctx.scale(scale, scale);
          for (const stroke of strokesRef.current) drawStroke(ctx, stroke);
          return out.toDataURL("image/png");
        },
      }),
      [cssSize, clear]
    );

    const TOOLS: { id: SketchTool; icon: typeof Pencil; label: string }[] = [
      { id: "pen", icon: Pencil, label: "Pen" },
      { id: "highlighter", icon: Highlighter, label: "Highlighter" },
      { id: "eraser", icon: Eraser, label: "Eraser" },
      { id: "line", icon: Minus, label: "Line" },
      { id: "rect", icon: Square, label: "Rectangle" },
      { id: "ellipse", icon: Circle, label: "Ellipse" },
    ];

    const canUndo = strokeCount > 0;
    const canRedo = redoCount > 0;

    return (
      <div className={cn("flex flex-col gap-2", className)}>
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-1 rounded-lg border bg-muted/30 p-1.5">
          {TOOLS.map(({ id, icon: Icon, label }) => (
            <Tooltip key={id}>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setTool(id)}
                  className={cn(
                    "h-9 w-9 p-0",
                    tool === id && "bg-background text-foreground shadow-sm ring-1 ring-border"
                  )}
                >
                  <Icon className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{label}</TooltipContent>
            </Tooltip>
          ))}

          <Separator orientation="vertical" className="mx-1 h-6" />

          {/* Color palette */}
          {PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Color ${c}`}
              onClick={() => setColor(c)}
              className={cn(
                "h-6 w-6 rounded-full border transition-transform",
                color === c ? "scale-110 ring-2 ring-offset-1 ring-foreground" : "hover:scale-105"
              )}
              style={{ backgroundColor: c }}
            />
          ))}
          <label className="relative inline-flex h-6 w-6 cursor-pointer items-center justify-center">
            <span
              className="h-6 w-6 rounded-full border bg-[conic-gradient(red,orange,yellow,lime,cyan,blue,magenta,red)]"
              aria-hidden
            />
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="absolute inset-0 cursor-pointer opacity-0"
              aria-label="Custom color"
            />
          </label>

          <Separator orientation="vertical" className="mx-1 h-6" />

          {/* Stroke size */}
          <div className="flex items-center gap-2 px-1">
            <span className="text-xs text-muted-foreground">Size</span>
            <Slider
              value={[size]}
              min={1}
              max={24}
              step={1}
              onValueChange={(v) => setSize(v[0])}
              className="w-24"
            />
          </div>

          <div className="flex-1" />

          {/* Background guide */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  setBackground((b) =>
                    b === "grid" ? "ruled" : b === "ruled" ? "blank" : "grid"
                  )
                }
                className="h-9 w-9 p-0"
              >
                <Grid3x3 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Background: {background}</TooltipContent>
          </Tooltip>

          <Separator orientation="vertical" className="mx-1 h-6" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" variant="ghost" size="sm" onClick={undo} disabled={!canUndo} className="h-9 w-9 p-0">
                <Undo2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Undo</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" variant="ghost" size="sm" onClick={redo} disabled={!canRedo} className="h-9 w-9 p-0">
                <Redo2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Redo</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" variant="ghost" size="sm" onClick={clear} disabled={!canUndo} className="h-9 w-9 p-0 text-destructive">
                <Trash2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Clear all</TooltipContent>
          </Tooltip>
        </div>

        {/* Canvas */}
        <div className="relative h-[55vh] min-h-[320px] w-full overflow-hidden rounded-lg border bg-white">
          <canvas
            ref={canvasRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={endStroke}
            onPointerLeave={endStroke}
            onPointerCancel={endStroke}
            className="absolute inset-0 touch-none"
            style={{ cursor: tool === "eraser" ? "cell" : "crosshair" }}
          />
        </div>
      </div>
    );
  }
);
