"use client";

/**
 * The project manager's dashboard at the top of /projects.
 *
 * Tabs answer the questions a PM asks in order: how is the portfolio doing
 * (Overview), when does it land (Timeline), what is coming at me (Look-ahead),
 * and are we keeping up (Throughput). The last tab is the plain project list.
 * The open tab is the URL hash, so a view can be linked to.
 */

import { useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Ban, CalendarClock, CheckCircle2, ListTodo, Send, Target, TrendingUp } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { SendToAgentLabel } from "@/components/agents/send-to-agent-label";
import { useSendToAgent } from "@/hooks/use-send-to-agent";
import { cn } from "@/lib/utils";
import { addDays, type PmProject, type PmUpcomingTask, type ProjectDashboard } from "@/lib/projects/dashboard";
import {
  BurnupChart,
  formatDay,
  GanttTimeline,
  HealthBadge,
  ProgressBar,
  ProgressLegend,
  relativeDay,
  ThroughputChart,
  WorkloadHeatmap,
} from "./pm-charts";

// ─── Tab ↔ hash ─────────────────────────────────────────────────────────

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "timeline", label: "Timeline" },
  { id: "lookahead", label: "Look-ahead" },
  { id: "throughput", label: "Throughput" },
  { id: "all", label: "All projects" },
] as const;
type TabId = (typeof TABS)[number]["id"];

function subscribeHash(cb: () => void) {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}

function useHashTab(): [TabId, (t: string) => void] {
  const hash = useSyncExternalStore(
    subscribeHash,
    () => window.location.hash.slice(1),
    () => ""
  );
  const tab = (TABS.find((t) => t.id === hash)?.id ?? "overview") as TabId;
  const setTab = (t: string) => {
    // replaceState keeps tab flips out of the back stack; dispatch so the store re-reads.
    window.history.replaceState(null, "", t === "overview" ? window.location.pathname : `#${t}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  };
  return [tab, setTab];
}

// ─── Data ───────────────────────────────────────────────────────────────

export function useProjectDashboard() {
  return useQuery<ProjectDashboard>({
    queryKey: ["projects", "dashboard"],
    queryFn: async () => {
      const res = await fetch("/api/projects/dashboard");
      if (!res.ok) throw new Error("Failed to load the project dashboard");
      return res.json();
    },
    staleTime: 60_000,
  });
}

// ─── Pieces ─────────────────────────────────────────────────────────────

function Kpi({
  label,
  value,
  hint,
  icon: Icon,
  tone,
  onClick,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon: typeof Target;
  tone?: "critical" | "warning" | "good";
  onClick?: () => void;
}) {
  const color =
    tone === "critical" ? "var(--pm-critical)" : tone === "warning" ? "var(--pm-warning)" : tone === "good" ? "var(--pm-good)" : undefined;
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      onClick={onClick}
      className={cn(
        "flex min-h-[84px] flex-col justify-between rounded-lg border bg-card p-3 text-left",
        onClick && "transition-colors hover:bg-muted/50"
      )}
    >
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5 shrink-0" style={color ? { color } : undefined} aria-hidden />
        {label}
      </span>
      <span className="text-2xl font-semibold leading-tight">{value}</span>
      {hint && <span className="truncate text-[11px] text-muted-foreground">{hint}</span>}
    </Comp>
  );
}

/** One sentence that says how the portfolio is doing, worst news first. */
function verdict(d: ProjectDashboard): string {
  const { kpis, projects } = d;
  if (kpis.openTasks === 0) return "Nothing open across your projects.";
  const worst = projects.find((p) => p.health === "at_risk");
  if (worst) {
    const more = kpis.atRisk > 1 ? ` and ${kpis.atRisk - 1} more` : "";
    return `${worst.name}${more} need${kpis.atRisk > 1 ? "" : "s"} attention: ${worst.healthReason}.`;
  }
  if (kpis.overdue) return `${kpis.overdue} task${kpis.overdue === 1 ? " is" : "s are"} overdue, but no project is at risk.`;
  return `All ${kpis.activeProjects} active projects are on track; ${kpis.dueNext7} due this week.`;
}

function PortfolioTable({ projects, today }: { projects: PmProject[]; today: string }) {
  const { sendToAgent } = useSendToAgent();
  if (projects.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">No active projects.</p>;
  }
  return (
    <div className="divide-y">
      <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_9rem] gap-3 pb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground lg:grid">
        <span>Project</span>
        <span>Progress</span>
        <span>Next due</span>
        <span>Forecast</span>
        <span className="sr-only">Actions</span>
      </div>
      {projects.map((p) => (
        <div
          key={p.id}
          className="grid grid-cols-2 gap-x-3 gap-y-2 py-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_9rem] lg:items-center lg:gap-3"
        >
          <div className="col-span-2 min-w-0 lg:col-span-1">
            <div className="flex items-center gap-2">
              <Link href={`/projects/${p.slug}`} className="truncate text-sm font-medium hover:underline">
                {p.name}
              </Link>
              <HealthBadge health={p.health} />
            </div>
            <p className="truncate text-xs text-muted-foreground">{p.healthReason}</p>
          </div>

          <div className="col-span-2 min-w-0 space-y-1 lg:col-span-1">
            <ProgressBar done={p.done} inProgress={p.inProgress} todo={p.todo} />
            <p className="text-xs text-muted-foreground tabular-nums">
              <span className="font-medium text-foreground">{p.percentDone}%</span> · {p.done}/{p.total} done
              {p.overdue > 0 && <span> · {p.overdue} overdue</span>}
              {p.blocked > 0 && <span> · {p.blocked} blocked</span>}
            </p>
          </div>

          <div className="min-w-0 text-xs">
            <span className="block text-muted-foreground lg:hidden">Next due</span>
            {p.nextDue ? (
              <Link href={`/tasks?task=${p.nextDue.taskId}`} className="hover:underline">
                <span className="line-clamp-1">{p.nextDue.title}</span>
                <span className={cn("text-muted-foreground", p.nextDue.overdue && "font-medium text-foreground")}>
                  {relativeDay(p.nextDue.date, today)}
                </span>
              </Link>
            ) : (
              <span className="text-muted-foreground">No dated tasks</span>
            )}
          </div>

          <div className="text-xs">
            <span className="block text-muted-foreground lg:hidden">Forecast</span>
            {p.forecastEnd ? (
              <>
                <span>{formatDay(p.forecastEnd)}</span>
                {p.slipDays !== null && p.slipDays !== 0 && (
                  <span className="block text-muted-foreground">
                    {p.slipDays > 0 ? `${p.slipDays}d behind plan` : `${-p.slipDays}d ahead of plan`}
                  </span>
                )}
                <span className="block text-muted-foreground">{p.weeklyPace}/wk pace</span>
              </>
            ) : (
              <span className="text-muted-foreground">{p.total - p.done === 0 ? "Complete" : "No recent pace"}</span>
            )}
          </div>

          <div className="col-span-2 flex lg:col-span-1 lg:justify-end">
            {(p.health === "at_risk" || p.health === "attention") && (
              <Button
                variant="ghost"
                size="sm"
                className="h-11 px-2 text-xs lg:h-9"
                title="Ask for a recovery plan for this project"
                onClick={() =>
                  sendToAgent({
                    id: p.id,
                    type: "project",
                    title: `Recovery plan: ${p.name} (${p.healthReason})`,
                    projectId: p.id,
                  })
                }
              >
                <Send className="mr-1.5 h-3.5 w-3.5" />
                <SendToAgentLabel />
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function UpcomingList({ tasks, today }: { tasks: PmUpcomingTask[]; today: string }) {
  const endOfWeek = addDays(today, 7);
  const endOfNext = addDays(today, 14);
  const groups: { label: string; items: PmUpcomingTask[] }[] = [
    { label: "Overdue", items: tasks.filter((t) => t.date < today) },
    { label: "Next 7 days", items: tasks.filter((t) => t.date >= today && t.date < endOfWeek) },
    { label: "Week after", items: tasks.filter((t) => t.date >= endOfWeek && t.date < endOfNext) },
    { label: "Later this month", items: tasks.filter((t) => t.date >= endOfNext) },
  ].filter((g) => g.items.length > 0);

  if (groups.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Nothing dated in the next 30 days.</p>;
  }

  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <section key={g.label}>
          <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {g.label === "Overdue" && <AlertTriangle className="h-3.5 w-3.5" style={{ color: "var(--pm-critical)" }} aria-hidden />}
            {g.label} <span className="font-normal">({g.items.length})</span>
          </h3>
          <ul className="divide-y rounded-lg border">
            {g.items.map((t) => (
              <li key={t.taskId} className="flex min-h-11 items-center gap-3 px-3 py-2">
                <span className="w-20 shrink-0 text-xs tabular-nums text-muted-foreground">
                  {formatDay(t.date)}
                  <span className="block">{relativeDay(t.date, today)}</span>
                </span>
                <div className="min-w-0 flex-1">
                  <Link href={`/tasks?task=${t.taskId}`} className="line-clamp-1 text-sm hover:underline">
                    {t.title}
                  </Link>
                  <span className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                    <Link href={`/projects/${t.projectSlug}`} className="hover:underline">
                      {t.projectName}
                    </Link>
                    {(t.priority === "urgent" || t.priority === "high") && <span className="capitalize">{t.priority}</span>}
                    {t.status === "in_progress" && <span>In progress</span>}
                    {t.blocked && (
                      <span className="inline-flex items-center gap-1">
                        <Ban className="h-3 w-3" style={{ color: "var(--pm-critical)" }} aria-hidden /> Blocked
                      </span>
                    )}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

// ─── Dashboard ──────────────────────────────────────────────────────────

export function PmDashboard({ directory }: { directory: ReactNode }) {
  const [tab, setTab] = useHashTab();
  const { data, isLoading, isError } = useProjectDashboard();

  return (
    <Tabs value={tab} onValueChange={setTab} className="pm-viz gap-4">
      <TabsList className="h-auto w-full justify-start overflow-x-auto sm:w-fit">
        {TABS.map((t) => (
          <TabsTrigger key={t.id} value={t.id} className="min-h-9 px-3 text-xs sm:text-sm">
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value="all">{directory}</TabsContent>

      {tab !== "all" && isLoading && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-[84px]" />
            ))}
          </div>
          <Skeleton className="h-64" />
        </div>
      )}

      {tab !== "all" && isError && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            The dashboard could not be loaded. Your projects are still listed under{" "}
            <button className="underline" onClick={() => setTab("all")}>
              All projects
            </button>
            .
          </CardContent>
        </Card>
      )}

      {data && (
        <>
          <TabsContent value="overview" className="space-y-4">
            <p className="text-sm">{verdict(data)}</p>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              <Kpi label="Active projects" value={data.kpis.activeProjects} icon={Target} />
              <Kpi
                label="At risk"
                value={data.kpis.atRisk}
                icon={AlertTriangle}
                tone={data.kpis.atRisk ? "critical" : "good"}
                hint={data.kpis.blocked ? `${data.kpis.blocked} blocked task${data.kpis.blocked === 1 ? "" : "s"}` : undefined}
              />
              <Kpi label="Open tasks" value={data.kpis.openTasks} icon={ListTodo} />
              <Kpi
                label="Overdue"
                value={data.kpis.overdue}
                icon={CalendarClock}
                tone={data.kpis.overdue ? "critical" : undefined}
                onClick={() => setTab("lookahead")}
                hint={`${data.kpis.dueNext7} due in 7 days`}
              />
              <Kpi label="Done, 30 days" value={data.kpis.completedLast30} icon={CheckCircle2} onClick={() => setTab("throughput")} />
              <Kpi
                label="On-time rate"
                value={data.kpis.onTimeRate === null ? "—" : `${data.kpis.onTimeRate}%`}
                icon={TrendingUp}
                tone={data.kpis.onTimeRate === null ? undefined : data.kpis.onTimeRate >= 80 ? "good" : "warning"}
                hint={data.kpis.onTimeSample ? `of ${data.kpis.onTimeSample} dated tasks` : "no dated tasks finished"}
              />
            </div>

            <Card>
              <CardHeader className="flex flex-col gap-2 p-4 pb-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <CardTitle className="text-base">Portfolio health</CardTitle>
                  <CardDescription className="text-xs">Worst first. Forecasts use each project&apos;s last four weeks of completions.</CardDescription>
                </div>
                <ProgressLegend />
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <PortfolioTable projects={data.projects} today={data.today} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="timeline">
            <Card>
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-base">Timeline</CardTitle>
                <CardDescription className="text-xs">
                  Each bar runs from a project&apos;s first task to its last due date. Dashed = where the current pace actually lands.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-4 pt-6">
                <GanttTimeline projects={data.projects} today={data.today} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="lookahead" className="space-y-4">
            <Card>
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-base">Workload, next 8 weeks</CardTitle>
                <CardDescription className="text-xs">
                  Open tasks due per week. Spot the crunch weeks before they arrive.
                  {data.undated > 0 && ` ${data.undated} open task${data.undated === 1 ? " has" : "s have"} no date in this window.`}
                </CardDescription>
              </CardHeader>
              <CardContent className="p-4 pt-2">
                <WorkloadHeatmap weeks={data.workloadWeeks} rows={data.workload} today={data.today} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-base">Coming up</CardTitle>
                <CardDescription className="text-xs">Everything overdue or due in the next 30 days, across projects.</CardDescription>
              </CardHeader>
              <CardContent className="p-4 pt-2">
                <UpcomingList tasks={data.upcoming} today={data.today} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="throughput" className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-base">Added vs completed</CardTitle>
                <CardDescription className="text-xs">Per week, last 12 weeks. When added outruns completed, the backlog grows.</CardDescription>
              </CardHeader>
              <CardContent className="p-4 pt-2">
                <ThroughputChart history={data.history} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-base">Burn-up</CardTitle>
                <CardDescription className="text-xs">Total scope against work done. The shaded gap is what is still open.</CardDescription>
              </CardHeader>
              <CardContent className="p-4 pt-2">
                <BurnupChart history={data.history} />
              </CardContent>
            </Card>
          </TabsContent>
        </>
      )}
    </Tabs>
  );
}
