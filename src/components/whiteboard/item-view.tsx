"use client";

/**
 * One whiteboard item, drawn in board coordinates.
 *
 * Every element carries `data-item-id` so the canvas resolves a pointer to
 * an item with `closest()` instead of per-item handlers, and resize handles
 * carry `data-handle`. Text is edited in place in a textarea with the same
 * metrics, so entering edit mode never makes the text jump.
 */

import { memo, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bot, CheckCircle2, Circle, FileText, LayoutDashboard, ListTodo } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CardRef, WhiteboardItem } from "@/lib/whiteboards/types";
import { COLOR_STYLES } from "./board-styles";

export const HANDLES = ["nw", "ne", "sw", "se"] as const;
export type Handle = (typeof HANDLES)[number];

interface ItemViewProps {
  item: WhiteboardItem;
  selected: boolean;
  editing: boolean;
  zoom: number;
  /** Show resize handles (single selection, editable). */
  handles: boolean;
  cardRef?: CardRef;
  onCommitText: (id: string, text: string) => void;
  onToggleTask?: (ref: CardRef) => void;
  onOpenNoteBoard?: (noteId: string) => void;
}

function defaultFont(item: WhiteboardItem): number {
  if (item.props.fontSize) return item.props.fontSize;
  if (item.kind === "text") return 20;
  if (item.kind === "sticky") return item.text.length > 120 ? 14 : item.text.length > 50 ? 16 : 18;
  return 16;
}

function InlineEditor({
  item,
  className,
  style,
  onCommit,
}: {
  item: WhiteboardItem;
  className?: string;
  style?: React.CSSProperties;
  onCommit: (text: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(item.text);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onCommit(value)}
      onKeyDown={(e) => {
        // Escape and Cmd/Ctrl+Enter finish; Enter alone is a new line.
        if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
        e.stopPropagation();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      aria-label="Edit text"
      className={cn(
        "w-full h-full resize-none bg-transparent outline-none border-0 p-0 m-0 leading-snug",
        className
      )}
      style={style}
    />
  );
}

function Provenance({ item }: { item: WhiteboardItem }) {
  if (!item.source_actor || item.source_actor === "human") return null;
  return (
    <span
      className="absolute -top-2.5 -right-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow"
      title={`Added by ${item.source_label || "an agent"}`}
    >
      <Bot className="h-3 w-3" aria-hidden />
      <span className="sr-only">Added by {item.source_label || "an agent"}</span>
    </span>
  );
}

function ResizeHandles({ zoom }: { zoom: number }) {
  const size = 12 / zoom;
  return (
    <>
      {HANDLES.map((h) => (
        <span
          key={h}
          data-handle={h}
          className="absolute rounded-sm border-2 border-primary bg-background"
          style={{
            width: size,
            height: size,
            left: h.endsWith("w") ? -size / 2 : undefined,
            right: h.endsWith("e") ? -size / 2 : undefined,
            top: h.startsWith("n") ? -size / 2 : undefined,
            bottom: h.startsWith("s") ? -size / 2 : undefined,
            cursor: h === "nw" || h === "se" ? "nwse-resize" : "nesw-resize",
          }}
        />
      ))}
    </>
  );
}

function CardBody({
  item,
  cardRef,
  onToggleTask,
  onOpenNoteBoard,
}: {
  item: WhiteboardItem;
  cardRef?: CardRef;
  onToggleTask?: (ref: CardRef) => void;
  onOpenNoteBoard?: (noteId: string) => void;
}) {
  const ref = cardRef;
  const title = ref?.title ?? item.text ?? "…";
  if (item.ref_type === "task") {
    const done = ref?.status === "completed";
    return (
      <div className="flex h-full flex-col gap-1 p-3">
        <div className="flex items-start gap-2">
          <button
            type="button"
            className="-m-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-muted disabled:opacity-50"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => ref && !ref.missing && onToggleTask?.(ref)}
            disabled={!ref || ref.missing || !onToggleTask}
            aria-label={done ? "Mark task not done" : "Mark task done"}
          >
            {done ? <CheckCircle2 className="h-5 w-5 text-green-600" /> : <Circle className="h-5 w-5 text-muted-foreground" />}
          </button>
          <p className={cn("text-sm font-medium leading-snug line-clamp-3", done && "line-through text-muted-foreground")}>
            {title}
          </p>
        </div>
        <div className="mt-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          <ListTodo className="h-3.5 w-3.5" aria-hidden />
          <span>Task</span>
          {ref?.status && ref.status !== "completed" && <span>· {ref.status.replace("_", " ")}</span>}
          {ref?.due_date && <span>· due {ref.due_date.slice(0, 10)}</span>}
          {ref?.missing && <span>· unavailable</span>}
        </div>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col gap-1 p-3">
      <div className="flex items-start gap-2">
        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
        <p className="text-sm font-medium leading-snug line-clamp-3">{title}</p>
      </div>
      <div className="mt-auto flex items-center gap-2 text-xs">
        {ref && !ref.missing ? (
          <>
            <Link
              href={`/notes/${ref.slug ?? ref.id}`}
              className="inline-flex min-h-8 items-center rounded px-1.5 text-primary hover:bg-muted"
              onPointerDown={(e) => e.stopPropagation()}
            >
              Open note
            </Link>
            {onOpenNoteBoard && (
              <button
                type="button"
                className="inline-flex min-h-8 items-center gap-1 rounded px-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onOpenNoteBoard(ref.id)}
              >
                <LayoutDashboard className="h-3.5 w-3.5" aria-hidden />
                {ref.has_board ? "Its board" : "Start its board"}
              </button>
            )}
          </>
        ) : (
          <span className="text-muted-foreground">{ref?.missing ? "Note unavailable" : "Note"}</span>
        )}
      </div>
    </div>
  );
}

export const ItemView = memo(function ItemView({
  item,
  selected,
  editing,
  zoom,
  handles,
  cardRef,
  onCommitText,
  onToggleTask,
  onOpenNoteBoard,
}: ItemViewProps) {
  const style = COLOR_STYLES[item.color] ?? COLOR_STYLES.yellow;
  const box: React.CSSProperties = {
    position: "absolute",
    left: item.x,
    top: item.y,
    width: item.w,
    height: item.h,
  };
  const ring = selected ? "outline outline-2 outline-primary outline-offset-2" : "";
  const fontSize = defaultFont(item);
  const commit = (text: string) => onCommitText(item.id, text);

  if (item.kind === "frame") {
    return (
      <div
        data-item-id={item.id}
        className={cn("rounded-xl border-2 border-dashed", style.frame, ring)}
        style={box}
      >
        <div className="absolute left-0 right-0 top-0 flex h-12 items-center px-4">
          {editing ? (
            <InlineEditor item={item} onCommit={commit} className="text-lg font-semibold h-8" />
          ) : (
            <span className="truncate text-lg font-semibold text-foreground/80">{item.text || "Untitled frame"}</span>
          )}
        </div>
        <Provenance item={item} />
        {handles && <ResizeHandles zoom={zoom} />}
      </div>
    );
  }

  if (item.kind === "card") {
    return (
      <div
        data-item-id={item.id}
        className={cn(
          "rounded-lg border bg-card text-card-foreground shadow-sm",
          cardRef?.missing && "opacity-60",
          ring
        )}
        style={box}
      >
        <CardBody item={item} cardRef={cardRef} onToggleTask={onToggleTask} onOpenNoteBoard={onOpenNoteBoard} />
        <Provenance item={item} />
        {handles && <ResizeHandles zoom={zoom} />}
      </div>
    );
  }

  if (item.kind === "text") {
    return (
      <div data-item-id={item.id} className={cn("text-foreground", ring)} style={{ ...box, fontSize }}>
        {editing ? (
          <InlineEditor item={item} onCommit={commit} style={{ fontSize }} className="font-medium" />
        ) : (
          <p className="whitespace-pre-wrap break-words font-medium leading-snug">
            {item.text || <span className="text-muted-foreground">Text</span>}
          </p>
        )}
        <Provenance item={item} />
        {handles && <ResizeHandles zoom={zoom} />}
      </div>
    );
  }

  if (item.kind === "shape") {
    const shape = item.props.shape ?? "rect";
    return (
      <div data-item-id={item.id} className={cn(ring, shape === "ellipse" && "rounded-full")} style={box}>
        {shape === "diamond" ? (
          <svg className={cn("absolute inset-0 h-full w-full", style.stroke)} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
            <polygon points="50,1 99,50 50,99 1,50" fill="currentColor" fillOpacity={0.15} stroke="currentColor" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          </svg>
        ) : (
          <div className={cn("absolute inset-0 border-2", style.shape, shape === "ellipse" ? "rounded-[50%]" : "rounded-md")} />
        )}
        <div className="absolute inset-0 flex items-center justify-center p-3 text-center" style={{ fontSize }}>
          {editing ? (
            <InlineEditor item={item} onCommit={commit} style={{ fontSize }} className="text-center" />
          ) : (
            <p className="whitespace-pre-wrap break-words leading-snug">{item.text}</p>
          )}
        </div>
        <Provenance item={item} />
        {handles && <ResizeHandles zoom={zoom} />}
      </div>
    );
  }

  // Sticky
  return (
    <div
      data-item-id={item.id}
      className={cn("rounded-sm p-3 shadow-md", style.sticky, ring)}
      style={{ ...box, fontSize }}
    >
      {editing ? (
        <InlineEditor item={item} onCommit={commit} style={{ fontSize }} />
      ) : (
        <p className="h-full overflow-hidden whitespace-pre-wrap break-words leading-snug">{item.text}</p>
      )}
      <Provenance item={item} />
      {handles && <ResizeHandles zoom={zoom} />}
    </div>
  );
});
