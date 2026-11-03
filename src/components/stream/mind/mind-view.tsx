"use client";

/**
 * Mind map: the home screen. The user's stream, drawn full screen as their
 * brain.
 *
 * The most important thing right now sits at the centre and glows. The next
 * few for today orbit close around it. Everything else is the bigger picture
 * further out, gathered around the projects (and the people) it belongs to,
 * all inside a softly firing cortex. Ranking and layout are `buildMindGraph`
 * (pure, tested); drawing is `MindScene` (three.js, loaded on demand); this
 * component owns data, selection, actions and the overlays:
 *
 *   - top: greeting, date, and the Moment / Today / Life scale;
 *   - bottom: the card for the selected light, and the composer (speak or
 *     type). The scene is told how much of the screen they cover, so the
 *     brain centres in the space that is left.
 *
 * Built to be calm and obvious:
 *   - one label at a time (the moment, plus whatever you point at; project
 *     and people hubs are named in the Life view on larger screens);
 *   - Moment / Today / Life is the zoom (also the wheel and a pinch);
 *   - tap a light to look closer; the card says what it is, why it is where
 *     it is, and offers the one or two things you might do with it;
 *   - finishing the moment lets the next thing drift into the centre.
 *
 * Accessible without the canvas: the map takes arrow keys, the card is a live
 * region, and an ordered list of everything (most important first) is always
 * in the DOM and one tap away. Without WebGL that list is the page.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ExternalLink,
  Archive,
  MessageCircle,
  ListOrdered,
  Maximize2,
  Minimize2,
  RefreshCw,
  BellOff,
  Brain,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useTouchFirst } from "@/hooks/use-touch-first";
import { useCardSwipe } from "@/hooks/use-card-swipe";
import { useAskAbout } from "@/hooks/use-ask-about";
import { useLastVisit } from "@/hooks/use-last-visit";
import { usePrefersReducedMotion } from "@/hooks/use-stream-view";
import { useVoiceStore } from "@/lib/stores/voice-store";
import { useImmersive } from "@/hooks/use-immersive";
import {
  buildMindGraph,
  labelForType,
  PEOPLE_HUB_KEY,
  type MindNode,
  type MindSourceItem,
} from "@/lib/stream/mind";
import type { PulsePerson } from "@/lib/crm/pulse";
import { BrainComposer } from "../brain-composer";
import type { MindScene, MindView as MindZoom } from "./mind-scene";

const LIVE_STATUSES = "active,waiting,processing";

/** A contact from the CRM pulse, as a light in the brain. */
export function personToMindItem(person: PulsePerson): MindSourceItem {
  const at = person.at ?? "1970-01-01 00:00:00";
  return {
    id: person.id,
    type: "person",
    status: person.reason === "review" ? "waiting" : "active",
    title: person.name,
    content: null,
    projectName: person.ventureName,
    dueDate: person.reason === "follow_up" ? person.at : null,
    // For a recent conversation, "created" is when the user last spoke to them.
    createdAt: person.reason === "recent" ? at : "1970-01-01 00:00:00",
    updatedAt: at,
  };
}

/**
 * Three reads, merged: what is recent, what is due soonest (which keeps a
 * task that went overdue weeks ago on the map even though nobody has touched
 * it since), and the people the CRM says are worth a thought. A failed people
 * read leaves the rest of the brain intact.
 */
async function fetchMindItems(): Promise<MindSourceItem[]> {
  const recent = new URLSearchParams({ limit: "70", statuses: LIVE_STATUSES });
  const due = new URLSearchParams({
    limit: "40",
    statuses: LIVE_STATUSES,
    types: "task,reminder",
    sort: "due",
  });
  const [a, b, c] = await Promise.all([
    fetch(`/api/stream?${recent}`),
    fetch(`/api/stream?${due}`),
    fetch("/api/crm/pulse").catch(() => null),
  ]);
  if (!a.ok) throw new Error("Failed to load your stream");
  const first = ((await a.json()) as { items: MindSourceItem[] }).items ?? [];
  const second = b.ok ? (((await b.json()) as { items: MindSourceItem[] }).items ?? []) : [];
  let people: MindSourceItem[] = [];
  if (c?.ok) {
    const pulse = (await c.json().catch(() => null)) as { people?: PulsePerson[] } | null;
    people = (pulse?.people ?? []).map(personToMindItem);
  }
  return [...first, ...second, ...people];
}

type MindAction = "complete" | "archive" | "dismiss";

const ZOOMS: Array<{ id: MindZoom; label: string; hint: string }> = [
  { id: "moment", label: "Moment", hint: "The one thing that matters most right now" },
  { id: "today", label: "Today", hint: "What matters most today" },
  { id: "life", label: "Life", hint: "Everything, gathered around your projects and people" },
];
const ZOOM_ORDER: MindZoom[] = ["moment", "today", "life"];

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

export function openHref(node: MindNode): string | null {
  if (node.key === PEOPLE_HUB_KEY) return "/crm";
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
    case "person":
      return `/crm/${encodeURIComponent(item.id)}`;
    case "agent_output":
      return item.agentTaskId ? `/review?task=${encodeURIComponent(item.agentTaskId)}` : "/review";
    default:
      return null;
  }
}

/* ---- Small media hook: larger screens name the hubs. ------------------- */

const SM_QUERY = "(min-width: 640px)";
const hasMatchMedia = () => typeof window.matchMedia === "function";
const subscribeSm = (onChange: () => void) => {
  if (!hasMatchMedia()) return () => {};
  const mq = window.matchMedia(SM_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
};
const getSm = () => (hasMatchMedia() ? window.matchMedia(SM_QUERY).matches : true);
const getServerSm = () => true;

function getClientGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

interface MindViewProps {
  /** The server's greeting; the client replaces it with the viewer's own clock. */
  greeting: string;
  /** Tasks completed today, for the one line of encouragement. */
  completedToday?: number;
}

export function MindView({ greeting: serverGreeting, completedToday = 0 }: MindViewProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { resolvedTheme } = useTheme();
  const reducedMotion = usePrefersReducedMotion();
  const lastVisit = useLastVisit();
  const lastVisitMs = lastVisit?.getTime() ?? null;
  const { askAbout, canAskAbout } = useAskAbout();
  const largeScreen = useSyncExternalStore(subscribeSm, getSm, getServerSm);
  const isRecording = useVoiceStore((s) => s.isRecording);
  const voiceBusy = useVoiceStore((s) => s.isProcessing);
  const [immersive, setImmersive] = useImmersive();

  /*
   * The server renders in *its* timezone and the client in the viewer's, so
   * these legitimately differ on hydration; `suppressHydrationWarning` on the
   * nodes is the escape hatch for exactly this and costs no extra render.
   */
  const greeting = typeof window === "undefined" ? serverGreeting : getClientGreeting();

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
  const [cardOpen, setCardOpen] = useState(true);
  const [listOpen, setListOpen] = useState(false);

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

  const sectionRef = useRef<HTMLElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  // State, not a ref: labels and effects read it during render.
  const [scene, setScene] = useState<MindScene | null>(null);

  const zoomStep = useCallback((direction: 1 | -1) => {
    setZoom((z) => {
      const i = ZOOM_ORDER.indexOf(z) + direction;
      return ZOOM_ORDER[Math.max(0, Math.min(ZOOM_ORDER.length - 1, i))];
    });
  }, []);

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
              if (key) setCardOpen(true);
              // Tapping something on the far side brings the view out to it.
              if (key) setZoom((z) => (z === "moment" ? "today" : z));
            },
            onInteract: () => setTouched(true),
            onError: () => setSceneState("failed"),
            onZoomStep: zoomStep,
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
  }, [zoomStep]);

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

  // The overlays cover the top and bottom of the canvas; the brain centres in
  // the space between them.
  useEffect(() => {
    if (!scene) return;
    const measure = () => {
      const section = sectionRef.current?.getBoundingClientRect();
      const top = topRef.current?.getBoundingClientRect();
      const bottom = bottomRef.current?.getBoundingClientRect();
      if (!section) return;
      scene.setInsets(
        top ? top.bottom - section.top : 0,
        bottom && bottom.height > 0 ? section.bottom - bottom.top : 0
      );
    };
    const observer = new ResizeObserver(measure);
    for (const el of [sectionRef.current, topRef.current, bottomRef.current]) {
      if (el) observer.observe(el);
    }
    // Entering or leaving immersive moves the top overlay without resizing it.
    const top = topRef.current;
    top?.addEventListener("transitionend", measure);
    measure();
    return () => {
      observer.disconnect();
      top?.removeEventListener("transitionend", measure);
    };
  }, [scene, immersive]);

  // The composer and voice capture announce new content; refresh the brain.
  useEffect(() => {
    const refresh = () => queryClient.invalidateQueries({ queryKey: ["stream"] });
    window.addEventListener("stream-refresh", refresh);
    return () => window.removeEventListener("stream-refresh", refresh);
  }, [queryClient]);

  // A voice capture saves itself when it stops; when that finishes, look again.
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !voiceBusy) {
      void queryClient.invalidateQueries({ queryKey: ["stream"] });
    }
    wasBusy.current = voiceBusy;
  }, [voiceBusy, queryClient]);

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

  const select = useCallback((key: string | null) => {
    setSelectedKey(key);
    setCardOpen(true);
  }, []);

  const step = useCallback(
    (delta: number) => {
      if (ranked.length === 0) return;
      const from = activeRank < 0 ? 0 : activeRank;
      const next = (from + delta + ranked.length) % ranked.length;
      select(next === 0 ? null : ranked[next].key);
      setTouched(true);
      // Stepping beyond today's shell needs the wider view to see it.
      if (ranked[next].ring === "life") setZoom("life");
      else if (ranked[next].ring === "today") setZoom((z) => (z === "moment" ? "today" : z));
    },
    [ranked, activeRank, select]
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
    } else if (event.key === "+" || event.key === "=") {
      zoomStep(-1);
    } else if (event.key === "-") {
      zoomStep(1);
    }
  };

  /* ---- Labels ---------------------------------------------------------- */

  const labelKeys = useMemo(() => {
    const keys: string[] = [];
    if (graph.focusKey) keys.push(graph.focusKey);
    if (activeKey && !keys.includes(activeKey)) keys.push(activeKey);
    if (hoverKey && !keys.includes(hoverKey) && nodeByKey.has(hoverKey)) keys.push(hoverKey);
    // From afar, name the places the life ring gathers around.
    if (zoom === "life" && largeScreen) {
      for (const node of graph.nodes) {
        if (node.kind === "hub" && !keys.includes(node.key)) keys.push(node.key);
      }
    }
    return keys;
  }, [graph, activeKey, hoverKey, nodeByKey, zoom, largeScreen]);

  /* ---- Render ---------------------------------------------------------- */

  const empty = !isPending && !isError && graph.ranked.length === 0;
  const failed = sceneState === "failed";
  const dateLine = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date());
  const todayCount = graph.nodes.filter((n) => n.ring === "moment" || n.ring === "today").length;

  const rankedList = (
    <ol className="space-y-1">
      {ranked.map((node) => (
        <li key={node.key}>
          <button
            type="button"
            onClick={() => {
              select(node.rank === 0 ? null : node.key);
              setListOpen(false);
              if (node.ring === "life") setZoom("life");
            }}
            className="flex w-full min-h-12 items-center gap-3 rounded-xl px-2 text-left hover:bg-muted"
          >
            <span
              aria-hidden="true"
              className="h-3 w-3 shrink-0 rounded-full"
              style={{ background: node.color }}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-base sm:text-sm">{node.label}</span>
              <span className="block truncate text-sm text-muted-foreground sm:text-xs">
                {node.reason}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ol>
  );

  return (
    <section
      ref={sectionRef}
      aria-label="Your brain: what matters most"
      className={cn(
        "relative h-full w-full overflow-hidden",
        "bg-[radial-gradient(ellipse_at_50%_45%,#ffffff_0%,#f3f5fb_55%,#e6ebf5_100%)]",
        "dark:bg-[radial-gradient(ellipse_at_50%_45%,#18203a_0%,#0e1427_55%,#070a14_100%)]"
      )}
    >
      {/* The canvas mounts here. Focusable so the keyboard can walk it. */}
      <div
        ref={containerRef}
        tabIndex={0}
        role="application"
        aria-roledescription="map"
        aria-label="Your brain. Arrow keys move from the most important thing outward, Enter opens, Escape returns to the centre, plus and minus change the scale."
        onKeyDown={onKeyDown}
        className={cn(
          "absolute inset-0 cursor-grab outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/60",
          failed && "hidden"
        )}
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
                  "absolute left-0 top-0 max-w-[min(260px,72vw)] rounded-full px-3 py-1 text-center transition-opacity duration-300",
                  "bg-white/80 text-slate-800 shadow-sm ring-1 ring-black/5 backdrop-blur",
                  "dark:bg-slate-900/65 dark:text-slate-100 dark:ring-white/10",
                  node.kind === "hub" && "bg-white/60 dark:bg-slate-900/45"
                )}
              >
                {isFocus && (
                  <span className="block text-xs font-semibold uppercase tracking-[0.12em] text-amber-600 dark:text-amber-300">
                    Right now
                  </span>
                )}
                <span
                  className={cn(
                    "block truncate font-medium",
                    node.kind === "hub" ? "text-sm sm:text-xs" : "text-sm"
                  )}
                >
                  {node.label}
                </span>
              </div>
            );
          })}
      </div>

      {/* Top: who, when, and how far to look. Sits below the app header. */}
      <div
        ref={topRef}
        className={cn(
          "pointer-events-none absolute inset-x-0 px-4 pt-3 transition-[top] duration-300 ease-out motion-reduce:transition-none sm:px-5 lg:px-6",
          // Immersive: the header has slid away, so the overlay takes its place.
          immersive ? "top-[env(safe-area-inset-top)]" : "top-14"
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="pointer-events-auto min-w-0">
            <h1
              className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white sm:text-2xl"
              suppressHydrationWarning
            >
              {greeting}
            </h1>
            <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300" suppressHydrationWarning>
              {dateLine}
              {completedToday > 0 && (
                <span className="text-emerald-700 dark:text-emerald-300"> · {completedToday} done</span>
              )}
              {todayCount > 0 && <span> · {todayCount} on your mind</span>}
            </p>
            {!touched && !empty && !isPending && sceneState === "ready" && (
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Drag to turn · Tap a light · Pinch or scroll to zoom
              </p>
            )}
          </div>

          <div className="pointer-events-auto flex items-center gap-2">
            <div
              role="group"
              aria-label="How far to look"
              className="flex rounded-full bg-white/75 p-1 shadow-sm ring-1 ring-black/5 backdrop-blur dark:bg-slate-900/60 dark:ring-white/10"
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
                    "min-h-10 rounded-full px-3.5 text-sm font-medium transition-colors sm:min-h-9",
                    zoom === z.id
                      ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                      : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                  )}
                >
                  {z.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setImmersive(!immersive)}
              aria-pressed={immersive}
              aria-label={immersive ? "Show the top bar" : "Immersive: hide the top bar"}
              title={immersive ? "Show the top bar" : "Immersive: hide the top bar"}
              className="flex h-12 w-12 items-center justify-center rounded-full bg-white/75 text-slate-700 shadow-sm ring-1 ring-black/5 backdrop-blur hover:text-slate-900 dark:bg-slate-900/60 dark:text-slate-200 dark:ring-white/10 dark:hover:text-white sm:h-11 sm:w-11"
            >
              {immersive ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
            </button>
            <button
              type="button"
              onClick={() => setListOpen(true)}
              aria-label="Everything, most important first"
              title="Everything, most important first"
              className="flex h-12 w-12 items-center justify-center rounded-full bg-white/75 text-slate-700 shadow-sm ring-1 ring-black/5 backdrop-blur hover:text-slate-900 dark:bg-slate-900/60 dark:text-slate-200 dark:ring-white/10 dark:hover:text-white sm:h-11 sm:w-11"
            >
              <ListOrdered className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>

      {/* States drawn over the brain. */}
      {(isPending || sceneState === "loading") && !isError && !failed && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-24 w-24 animate-pulse rounded-full bg-amber-200/40 blur-2xl dark:bg-amber-200/20" />
        </div>
      )}

      {isError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-base text-slate-700 dark:text-slate-200">Couldn&apos;t load what&apos;s on your mind.</p>
          <Button variant="outline" className="h-11 rounded-full px-5" onClick={() => refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Try again
          </Button>
        </div>
      )}

      {empty && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
          <Brain className="mb-3 h-9 w-9 text-slate-400 dark:text-slate-500" />
          <p className="text-lg font-medium text-slate-800 dark:text-slate-100">Your mind is clear</p>
          <p className="mt-1 max-w-xs text-base text-slate-500 dark:text-slate-400">
            Tap + to capture a thought, by voice or by typing. The most important thing settles in the middle.
          </p>
        </div>
      )}

      {/* Without WebGL, the list is the page. */}
      {failed && (
        <div className="absolute inset-x-0 bottom-0 top-36 overflow-y-auto px-4 pb-[calc(var(--mobile-nav-height)+6rem)] lg:pb-28">
          <div className="mx-auto max-w-2xl rounded-2xl border bg-card p-4">
            <p className="mb-3 text-sm text-muted-foreground">
              This screen can&apos;t draw your brain, so here is the same picture as a list.
            </p>
            <h2 className="mb-2 text-base font-semibold">Most important first</h2>
            {rankedList}
          </div>
        </div>
      )}

      {/* Bottom: the card for the selected light, and the composer. */}
      <div
        ref={bottomRef}
        className="pointer-events-none absolute inset-x-0 bottom-[calc(var(--mobile-nav-height)+0.5rem)] flex flex-col gap-3 px-3 sm:px-4 lg:bottom-5 lg:px-6"
      >
        {/* Desktop only: on phones and tablets the dock's centre orb is the +. */}
        <div className="hidden lg:absolute lg:bottom-0 lg:right-6 lg:flex">
          <BrainComposer className="pointer-events-auto" />
        </div>

        {active && !isRecording && (
          <div className="pointer-events-auto mx-auto w-full max-w-xl lg:max-w-2xl lg:pr-20 xl:pr-0">
            {cardOpen ? (
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
                onCollapse={() => setCardOpen(false)}
              />
            ) : (
              <button
                type="button"
                onClick={() => setCardOpen(true)}
                className="mx-auto flex min-h-12 max-w-full items-center gap-2 rounded-full border bg-card/90 px-4 text-left shadow-sm backdrop-blur"
              >
                <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: active.color }} />
                <span className="truncate text-base font-medium sm:text-sm">{active.label}</span>
                <ChevronUp className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="sr-only">Show details</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Everything, most important first. Read by screen readers always. */}
      {!failed && (
        <div className="sr-only">
          <h2>Most important first</h2>
          {rankedList}
        </div>
      )}

      <Sheet open={listOpen} onOpenChange={setListOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle className="text-lg">Most important first</SheetTitle>
            <SheetDescription className="text-base sm:text-sm">
              Everything in your brain, ranked by how much it needs you now.
            </SheetDescription>
          </SheetHeader>
          <div className="px-2 pb-6">{rankedList}</div>
        </SheetContent>
      </Sheet>
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
  onCollapse: () => void;
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
  onCollapse,
}: MindCardProps) {
  const item = node.item;
  const type = item?.type ?? "project";
  const preview = item ? plainText(item.content) : "";
  const showPreview = preview && preview !== plainText(item?.title);
  const canComplete = type === "task";
  const canDismiss = type === "reminder";
  const canArchive = !!item && type !== "agent_output" && type !== "person";
  const touchFirst = useTouchFirst();
  // Swipe like flipping through stories: left for the next item, right for
  // the previous one, down to tuck the card away, up to open the item.
  const [swipeRef, swipeHandlers] = useCardSwipe({
    left: onNext,
    right: onPrev,
    down: onCollapse,
    up: onOpen,
  });
  const kindLabel = isFocus
    ? "Right now"
    : node.key === PEOPLE_HUB_KEY
      ? "People"
      : node.kind === "hub"
        ? "Project"
        : labelForType(type);

  return (
    <div
      ref={swipeRef}
      {...swipeHandlers}
      className={cn(
        "rounded-2xl px-4 py-3 shadow-lg backdrop-blur",
        isFocus ? "bp-focus" : "bp-surface bg-card/95",
        touchFirst && "touch-none select-none"
      )}
      aria-live="polite"
      aria-atomic="true"
    >
      {touchFirst && (
        // A grab handle, the platform's own sign for "this moves".
        <div aria-hidden="true" className="-mt-1 mb-1.5 flex justify-center">
          <span className="h-1 w-9 rounded-full bg-muted-foreground/30" />
        </div>
      )}
      <div className="flex min-h-7 items-center gap-2 text-sm text-muted-foreground sm:text-xs">
        <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: node.color }} />
        <span className="shrink-0 font-semibold uppercase tracking-wider">{kindLabel}</span>
        <span aria-hidden="true">·</span>
        <span className="truncate">{node.reason}</span>
        {item?.projectName && node.kind !== "hub" && (
          <span className="hidden truncate sm:inline">· {item.projectName}</span>
        )}
        <span className="-my-2 ml-auto flex shrink-0 items-center">
          {position && (
            <span className={cn("mr-1 tabular-nums", touchFirst ? "inline" : "hidden sm:inline")}>{position}</span>
          )}
          {onPrev && (
            <button
              type="button"
              onClick={onPrev}
              className={cn("flex h-11 w-11 items-center justify-center rounded-full hover:bg-muted sm:h-9 sm:w-9", touchFirst && "sr-only")}
              aria-label="More important"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          )}
          {onNext && (
            <button
              type="button"
              onClick={onNext}
              className={cn("flex h-11 w-11 items-center justify-center rounded-full hover:bg-muted sm:h-9 sm:w-9", touchFirst && "sr-only")}
              aria-label="Less important"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          )}
          <button
            type="button"
            onClick={onCollapse}
            className={cn("-mr-2 flex h-11 w-11 items-center justify-center rounded-full hover:bg-muted sm:h-9 sm:w-9", touchFirst && "sr-only")}
            aria-label="Hide details"
          >
            <ChevronDown className="h-5 w-5" />
          </button>
        </span>
      </div>

      <h2 className="mt-1 text-lg font-semibold leading-snug">{node.label}</h2>
      {showPreview && (
        <p className="mt-1 line-clamp-1 text-base text-muted-foreground sm:line-clamp-2 sm:text-sm">{preview}</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {canComplete && (
          <Button className="h-11 rounded-full px-4 text-base sm:h-9 sm:text-sm" disabled={busy} onClick={() => onAction("complete")}>
            <Check className="mr-1.5 h-4 w-4" />
            Done
          </Button>
        )}
        {canDismiss && (
          <Button className="h-11 rounded-full px-4 text-base sm:h-9 sm:text-sm" disabled={busy} onClick={() => onAction("dismiss")}>
            <BellOff className="mr-1.5 h-4 w-4" />
            Dismiss
          </Button>
        )}
        {onOpen && (
          <Button variant="outline" className="h-11 rounded-full px-4 text-base sm:h-9 sm:text-sm" onClick={onOpen}>
            <ExternalLink className="mr-1.5 h-4 w-4" />
            Open
          </Button>
        )}
        {canAsk && (
          <Button
            variant="outline"
            aria-label="Ask about this"
            className="h-11 rounded-full px-4 text-base sm:h-9 sm:text-sm"
            onClick={onAsk}
          >
            <MessageCircle className="mr-1.5 h-4 w-4" />
            <span>
              Ask<span className="hidden sm:inline"> about this</span>
            </span>
          </Button>
        )}
        {canArchive && (
          <Button
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

        {onBack && (
          <Button variant="ghost" className="ml-auto h-11 rounded-full px-3 text-base sm:h-9 sm:text-sm" onClick={onBack}>
            Back to now
          </Button>
        )}
      </div>
    </div>
  );
}
