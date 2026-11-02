"use client";

/**
 * Mind map: the dashboard's stream, drawn as a quiet neural network.
 *
 * The most important thing right now sits at the centre and glows. The next
 * few for today orbit close around it. Everything else is the bigger picture
 * further out, gathered around the projects it belongs to. Ranking and layout
 * are `buildMindGraph` (pure, tested); drawing is `MindScene` (three.js,
 * loaded on demand); this component owns data, selection and actions.
 *
 * Built to be calm and obvious:
 *   - one label at a time (the moment, plus whatever you point at);
 *   - Moment / Today / Life is the zoom, no gestures to learn;
 *   - tap a light to look closer; the card below says what it is, why it is
 *     where it is, and offers the one or two things you might do with it;
 *   - finishing the moment lets the next thing drift into the centre.
 *
 * Accessible without the canvas: the panel takes arrow keys, the card is a
 * live region, and an ordered list of everything (most important first) is
 * always in the DOM. Without WebGL that list is shown instead of the map.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Archive,
  MessageCircle,
  List,
  RefreshCw,
  BellOff,
  Brain,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAskAbout } from "@/hooks/use-ask-about";
import { useLastVisit } from "@/hooks/use-last-visit";
import { usePrefersReducedMotion } from "@/hooks/use-stream-view";
import {
  buildMindGraph,
  labelForType,
  type MindNode,
  type MindSourceItem,
} from "@/lib/stream/mind";
import type { MindScene, MindView as MindZoom } from "./mind-scene";

const LIVE_STATUSES = "active,waiting,processing";

/**
 * Two reads of the existing stream API, merged: what is recent, and what is
 * due soonest. The second is what keeps a task that went overdue weeks ago
 * on the map even though nobody has touched it since.
 */
async function fetchMindItems(): Promise<MindSourceItem[]> {
  const recent = new URLSearchParams({ limit: "70", statuses: LIVE_STATUSES });
  const due = new URLSearchParams({
    limit: "40",
    statuses: LIVE_STATUSES,
    types: "task,reminder",
    sort: "due",
  });
  const [a, b] = await Promise.all([
    fetch(`/api/stream?${recent}`),
    fetch(`/api/stream?${due}`),
  ]);
  if (!a.ok) throw new Error("Failed to load your stream");
  const first = ((await a.json()) as { items: MindSourceItem[] }).items ?? [];
  const second = b.ok ? (((await b.json()) as { items: MindSourceItem[] }).items ?? []) : [];
  return [...first, ...second];
}

type MindAction = "complete" | "archive" | "dismiss";

const ZOOMS: Array<{ id: MindZoom; label: string; hint: string }> = [
  { id: "moment", label: "Moment", hint: "The one thing that matters most right now" },
  { id: "today", label: "Today", hint: "What matters most today" },
  { id: "life", label: "Life", hint: "Everything, gathered around your projects" },
];

function plainText(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[#*_>`]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function openHref(node: MindNode): string | null {
  if (node.kind === "hub") return `/projects/${encodeURIComponent(node.key.slice(4))}`;
  const item = node.item;
  if (!item) return null;
  switch (item.type) {
    case "note":
      return `/notes/${item.id}`;
    case "journal":
      return "/journal";
    case "task":
      return `/tasks?task=${encodeURIComponent(item.id)}`;
    case "agent_output":
      return item.agentTaskId ? `/review?task=${encodeURIComponent(item.agentTaskId)}` : "/review";
    default:
      return null;
  }
}

interface MindViewProps {
  onShowList?: () => void;
}

export function MindView({ onShowList }: MindViewProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { resolvedTheme } = useTheme();
  const reducedMotion = usePrefersReducedMotion();
  const lastVisit = useLastVisit();
  const lastVisitMs = lastVisit?.getTime() ?? null;
  const { askAbout, canAskAbout } = useAskAbout();

  const { data, isPending, isError, refetch, dataUpdatedAt } = useQuery({
    // Under "stream" so every existing invalidation (Brain Bar, row actions)
    // refreshes the map too.
    queryKey: ["stream", "mind"],
    queryFn: fetchMindItems,
    refetchInterval: 5 * 60 * 1000,
  });

  // Items acted on, hidden at once and restored if the write fails.
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [zoom, setZoom] = useState<MindZoom>("today");
  const [touched, setTouched] = useState(false);
  const [sceneState, setSceneState] = useState<"loading" | "ready" | "failed">("loading");

  const graph = useMemo(
    () =>
      buildMindGraph(
        (data ?? []).filter((item) => !hidden.has(`${item.type}:${item.id}`)),
        {
          // The clock the data was read at, so ranking is pure and stable
          // between renders, and moves on with each refresh.
          now: new Date(dataUpdatedAt || 0),
          lastVisitAt: lastVisitMs ? new Date(lastVisitMs) : null,
        }
      ),
    [data, hidden, dataUpdatedAt, lastVisitMs]
  );

  const nodeByKey = useMemo(() => new Map(graph.nodes.map((n) => [n.key, n])), [graph]);
  const activeKey =
    selectedKey && nodeByKey.has(selectedKey) ? selectedKey : graph.focusKey;
  const active = activeKey ? nodeByKey.get(activeKey) ?? null : null;
  const focus = graph.focusKey ? nodeByKey.get(graph.focusKey) ?? null : null;

  /* ---- The scene ------------------------------------------------------- */

  const containerRef = useRef<HTMLDivElement>(null);
  // State, not a ref: labels and effects read it during render.
  const [scene, setScene] = useState<MindScene | null>(null);

  useEffect(() => {
    let cancelled = false;
    let created: MindScene | null = null;

    import("./mind-scene")
      .then(({ MindScene }) => {
        if (cancelled || !containerRef.current) return;
        try {
          created = new MindScene({
            container: containerRef.current,
            theme: "dark",
            reducedMotion: false,
            onHover: (key) => setHoverKey(key),
            onSelect: (key) => {
              setSelectedKey(key);
              // Tapping something on the far side brings the view out to it.
              if (key) setZoom((z) => (z === "moment" ? "today" : z));
            },
            onInteract: () => setTouched(true),
            onError: () => setSceneState("failed"),
          });
          setScene(created);
          setSceneState("ready");
        } catch {
          setSceneState("failed");
        }
      })
      .catch(() => {
        if (!cancelled) setSceneState("failed");
      });

    return () => {
      cancelled = true;
      created?.dispose();
      setScene(null);
    };
  }, []);

  useEffect(() => {
    scene?.setGraph(graph);
  }, [scene, graph]);

  useEffect(() => {
    // The moment is selected by default; telling the scene so would stop its
    // idle drift, so only an explicit choice is passed on.
    scene?.setSelected(activeKey && activeKey !== graph.focusKey ? activeKey : null);
  }, [scene, activeKey, graph.focusKey]);

  useEffect(() => {
    scene?.setView(zoom);
  }, [scene, zoom]);

  useEffect(() => {
    scene?.setTheme(resolvedTheme === "light" ? "light" : "dark");
  }, [scene, resolvedTheme]);

  useEffect(() => {
    scene?.setReducedMotion(reducedMotion);
  }, [scene, reducedMotion]);

  // The Brain Bar announces new content with this event.
  useEffect(() => {
    const refresh = () => queryClient.invalidateQueries({ queryKey: ["stream"] });
    window.addEventListener("stream-refresh", refresh);
    return () => window.removeEventListener("stream-refresh", refresh);
  }, [queryClient]);

  /* ---- Actions --------------------------------------------------------- */

  const act = useMutation({
    mutationFn: async ({ node, action }: { node: MindNode; action: MindAction }) => {
      const item = node.item!;
      const request =
        action === "complete"
          ? { url: `/api/tasks/${item.id}`, body: { status: "completed" } }
          : action === "dismiss"
            ? { url: `/api/reminders/${item.id}`, body: { status: "dismissed" } }
            : { url: `/api/stream/${item.id}`, body: { status: "archived" } };
      const res = await fetch(request.url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request.body),
      });
      if (!res.ok) throw new Error(action);
    },
    onMutate: ({ node }) => {
      setHidden((prev) => new Set(prev).add(node.key));
      setSelectedKey(null);
    },
    onError: (_error, { node, action }) => {
      setHidden((prev) => {
        const next = new Set(prev);
        next.delete(node.key);
        return next;
      });
      toast.error(
        action === "complete"
          ? "Couldn't mark that done. Try again."
          : action === "dismiss"
            ? "Couldn't dismiss that reminder. Try again."
            : "Couldn't archive that. It's still here."
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["stream"] }),
  });

  const ranked = graph.ranked;
  const activeRank = active && active.rank >= 0 ? active.rank : -1;

  const step = useCallback(
    (delta: number) => {
      if (ranked.length === 0) return;
      const from = activeRank < 0 ? 0 : activeRank;
      const next = (from + delta + ranked.length) % ranked.length;
      setSelectedKey(next === 0 ? null : ranked[next].key);
      setTouched(true);
      // Stepping beyond today's shell needs the wider view to see it.
      if (ranked[next].ring === "life") setZoom("life");
      else if (ranked[next].ring === "today") setZoom((z) => (z === "moment" ? "today" : z));
    },
    [ranked, activeRank]
  );

  const open = useCallback(
    (node: MindNode) => {
      const href = openHref(node);
      if (href) router.push(href);
    },
    [router]
  );

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      step(1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      step(-1);
    } else if (event.key === "Escape") {
      setSelectedKey(null);
    } else if (event.key === "Enter" && active) {
      open(active);
    }
  };

  /* ---- Labels ---------------------------------------------------------- */

  const labelKeys = useMemo(() => {
    const keys: string[] = [];
    if (graph.focusKey) keys.push(graph.focusKey);
    if (activeKey && !keys.includes(activeKey)) keys.push(activeKey);
    if (hoverKey && !keys.includes(hoverKey) && nodeByKey.has(hoverKey)) keys.push(hoverKey);
    return keys;
  }, [graph.focusKey, activeKey, hoverKey, nodeByKey]);

  /* ---- Render ---------------------------------------------------------- */

  const empty = !isPending && !isError && graph.ranked.length === 0;
  const failed = sceneState === "failed";

  return (
    <section aria-label="What matters most" className="space-y-3">
      <div
        className={cn(
          "relative overflow-hidden rounded-3xl border",
          "border-slate-200/70 bg-[radial-gradient(ellipse_at_50%_45%,#ffffff_0%,#f3f5fb_55%,#e9edf6_100%)]",
          "dark:border-white/5 dark:bg-[radial-gradient(ellipse_at_50%_45%,#18203a_0%,#0e1427_55%,#080b16_100%)]",
          failed ? "hidden" : "h-[clamp(320px,56dvh,580px)]"
        )}
      >
        {/* The canvas mounts here. Focusable so the keyboard can walk it. */}
        <div
          ref={containerRef}
          tabIndex={0}
          role="application"
          aria-roledescription="map"
          aria-label="Mind map. Use the arrow keys to move from the most important thing outward, Enter to open, Escape to return to the centre."
          onKeyDown={onKeyDown}
          className="absolute inset-0 cursor-grab outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-inset rounded-3xl"
        />

        {/* Labels follow their nodes; the scene moves them every frame. */}
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          {scene &&
            labelKeys.map((key) => {
              const node = nodeByKey.get(key);
              if (!node) return null;
              const isFocus = key === graph.focusKey;
              return (
                <div
                  key={key}
                  ref={(el) => {
                    if (!el) return;
                    scene.bindLabel(key, el);
                    return () => scene.bindLabel(key, null);
                  }}
                  style={{ opacity: 0 }}
                  className={cn(
                    "absolute left-0 top-0 max-w-[min(240px,70vw)] rounded-full px-3 py-1 text-center transition-opacity duration-300",
                    "bg-white/75 text-slate-800 shadow-sm ring-1 ring-black/5 backdrop-blur",
                    "dark:bg-slate-900/60 dark:text-slate-100 dark:ring-white/10"
                  )}
                >
                  {isFocus && (
                    <span className="block text-[10px] font-medium uppercase tracking-[0.14em] text-amber-600 dark:text-amber-300">
                      Right now
                    </span>
                  )}
                  <span className="block truncate text-xs font-medium">{node.label}</span>
                </div>
              );
            })}
        </div>

        {/* Zoom: the three scales the user asked about. */}
        <div className="absolute left-3 top-3 flex items-center gap-2">
          <div
            role="group"
            aria-label="How far to look"
            className="flex rounded-full bg-white/70 p-0.5 shadow-sm ring-1 ring-black/5 backdrop-blur dark:bg-slate-900/50 dark:ring-white/10"
          >
            {ZOOMS.map((z) => (
              <button
                key={z.id}
                type="button"
                title={z.hint}
                aria-pressed={zoom === z.id}
                onClick={() => {
                  setZoom(z.id);
                  if (z.id === "moment") setSelectedKey(null);
                }}
                className={cn(
                  "min-h-9 rounded-full px-3 text-xs font-medium transition-colors",
                  zoom === z.id
                    ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                    : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                )}
              >
                {z.label}
              </button>
            ))}
          </div>
        </div>

        {onShowList && (
          <button
            type="button"
            onClick={onShowList}
            className="absolute right-3 top-3 flex min-h-9 items-center gap-1.5 rounded-full bg-white/70 px-3 text-xs font-medium text-slate-600 shadow-sm ring-1 ring-black/5 backdrop-blur hover:text-slate-900 dark:bg-slate-900/50 dark:text-slate-300 dark:ring-white/10 dark:hover:text-white"
            title="Show everything as a list, newest first"
          >
            <List className="h-3.5 w-3.5" />
            List
          </button>
        )}

        {/* States drawn over the map. */}
        {(isPending || sceneState === "loading") && !isError && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-16 w-16 animate-pulse rounded-full bg-amber-200/40 blur-xl dark:bg-amber-200/20" />
          </div>
        )}

        {isError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
            <p className="text-sm text-slate-700 dark:text-slate-200">Couldn&apos;t load what&apos;s on your mind.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Try again
            </Button>
          </div>
        )}

        {empty && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
            <Brain className="mb-3 h-7 w-7 text-slate-400 dark:text-slate-500" />
            <p className="text-base font-medium text-slate-800 dark:text-slate-100">Your mind is clear</p>
            <p className="mt-1 max-w-xs text-sm text-slate-500 dark:text-slate-400">
              Type anything into the Brain Bar. The most important thing will settle in the middle.
            </p>
          </div>
        )}

        {!touched && !empty && !isPending && sceneState === "ready" && (
          <p className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] text-slate-500 dark:text-slate-400">
            Drag to turn · Tap a light to look closer
          </p>
        )}
      </div>

      {/* The card: what this is, why it's here, and what you might do. */}
      {active && (
        <MindCard
          node={active}
          isFocus={active.key === graph.focusKey}
          position={activeRank >= 0 ? `${activeRank + 1} of ${ranked.length}` : null}
          busy={act.isPending}
          canAsk={!!active.item && canAskAbout(active.item.type)}
          onPrev={ranked.length > 1 ? () => step(-1) : undefined}
          onNext={ranked.length > 1 ? () => step(1) : undefined}
          onBack={active.key !== graph.focusKey && focus ? () => setSelectedKey(null) : undefined}
          onOpen={openHref(active) ? () => open(active) : undefined}
          onAsk={() => {
            const item = active.item;
            if (item) askAbout({ id: item.id, type: item.type, title: item.title, content: item.content ?? "" });
          }}
          onAction={(action) => act.mutate({ node: active, action })}
        />
      )}

      {/* Everything, most important first. Read by screen readers always;
          shown to everyone when the map cannot be drawn. */}
      <div className={failed ? "rounded-2xl border p-4" : "sr-only"}>
        {failed && (
          <p className="mb-3 text-xs text-muted-foreground">
            This screen can&apos;t draw the map, so here is the same picture as a list.
          </p>
        )}
        <h2 className={failed ? "mb-2 text-sm font-semibold" : undefined}>
          Most important first
        </h2>
        <ol className="space-y-1">
          {ranked.map((node) => (
            <li key={node.key}>
              <button
                type="button"
                onClick={() => setSelectedKey(node.rank === 0 ? null : node.key)}
                className="flex w-full min-h-11 items-center gap-3 rounded-lg px-2 text-left hover:bg-muted"
              >
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: node.color }}
                />
                <span className="min-w-0 flex-1 truncate text-sm">{node.label}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{node.reason}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------------ */

interface MindCardProps {
  node: MindNode;
  isFocus: boolean;
  position: string | null;
  busy: boolean;
  canAsk: boolean;
  onPrev?: () => void;
  onNext?: () => void;
  onBack?: () => void;
  onOpen?: () => void;
  onAsk: () => void;
  onAction: (action: MindAction) => void;
}

function MindCard({
  node,
  isFocus,
  position,
  busy,
  canAsk,
  onPrev,
  onNext,
  onBack,
  onOpen,
  onAsk,
  onAction,
}: MindCardProps) {
  const item = node.item;
  const type = item?.type ?? "project";
  const preview = item ? plainText(item.content) : "";
  const showPreview = preview && preview !== plainText(item?.title);
  const canComplete = type === "task";
  const canDismiss = type === "reminder";
  const canArchive = !!item && type !== "agent_output";

  return (
    <div
      className="rounded-2xl border bg-card px-4 py-3 shadow-sm"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: node.color }} />
        <span className="font-medium uppercase tracking-wider">
          {isFocus ? "Right now" : node.kind === "hub" ? "Project" : labelForType(type)}
        </span>
        <span aria-hidden="true">·</span>
        <span className="truncate">{node.reason}</span>
        {item?.projectName && node.kind !== "hub" && (
          <>
            <span aria-hidden="true">·</span>
            <span className="truncate">{item.projectName}</span>
          </>
        )}
        {position && <span className="ml-auto shrink-0 tabular-nums">{position}</span>}
      </div>

      <h2 className="mt-1.5 text-base font-semibold leading-snug lg:text-lg">{node.label}</h2>
      {showPreview && (
        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{preview}</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {canComplete && (
          <Button size="sm" className="h-11 rounded-full px-4 sm:h-9" disabled={busy} onClick={() => onAction("complete")}>
            <Check className="mr-1.5 h-4 w-4" />
            Done
          </Button>
        )}
        {canDismiss && (
          <Button size="sm" className="h-11 rounded-full px-4 sm:h-9" disabled={busy} onClick={() => onAction("dismiss")}>
            <BellOff className="mr-1.5 h-4 w-4" />
            Dismiss
          </Button>
        )}
        {onOpen && (
          <Button size="sm" variant="outline" className="h-11 rounded-full px-4 sm:h-9" onClick={onOpen}>
            <ExternalLink className="mr-1.5 h-4 w-4" />
            Open
          </Button>
        )}
        {canAsk && (
          <Button size="sm" variant="outline" className="h-11 rounded-full px-4 sm:h-9" onClick={onAsk}>
            <MessageCircle className="mr-1.5 h-4 w-4" />
            Ask about this
          </Button>
        )}
        {canArchive && (
          <Button
            size="sm"
            variant="ghost"
            className="h-11 rounded-full px-3 text-muted-foreground sm:h-9"
            disabled={busy}
            onClick={() => onAction("archive")}
            title="Archive: out of sight, still searchable"
          >
            <Archive className="h-4 w-4" />
            <span className="sr-only sm:not-sr-only sm:ml-1.5">Archive</span>
          </Button>
        )}

        <div className="ml-auto flex items-center gap-1">
          {onBack && (
            <Button size="sm" variant="ghost" className="h-11 rounded-full px-3 text-xs sm:h-9" onClick={onBack}>
              Back to now
            </Button>
          )}
          {onPrev && (
            <Button size="icon" variant="ghost" className="h-11 w-11 rounded-full sm:h-9 sm:w-9" onClick={onPrev} aria-label="More important">
              <ChevronLeft className="h-4 w-4" />
            </Button>
          )}
          {onNext && (
            <Button size="icon" variant="ghost" className="h-11 w-11 rounded-full sm:h-9 sm:w-9" onClick={onNext} aria-label="Less important">
              <ChevronRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
