"use client";

import type { ReactNode } from "react";
import type { GraphInsight, GraphNode, GraphStats } from "@/app/api/graph/route";
import { Badge } from "@/components/ui/badge";
import {
  Waypoints,
  Unlink,
  ArrowRightLeft,
  Link2,
  Sparkles,
  ExternalLink,
  TrendingUp,
  CircleDot,
  ShieldCheck,
  Puzzle,
} from "lucide-react";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

const insightIcons: Record<string, ReactNode> = {
  hub: <Waypoints className="h-4 w-4 text-blue-500" />,
  orphan: <Puzzle className="h-4 w-4 text-amber-500" />,
  bridge: <ArrowRightLeft className="h-4 w-4 text-purple-500" />,
  strong_pair: <Link2 className="h-4 w-4 text-green-500" />,
  recent_connection: <Sparkles className="h-4 w-4 text-cyan-500" />,
};

const insightColors: Record<string, string> = {
  hub: "border-blue-500/20 bg-blue-500/5",
  orphan: "border-amber-500/20 bg-amber-500/5",
  bridge: "border-purple-500/20 bg-purple-500/5",
  strong_pair: "border-green-500/20 bg-green-500/5",
  recent_connection: "border-cyan-500/20 bg-cyan-500/5",
};

// Friendly names for insight types
const insightTypeLabels: Record<string, string> = {
  hub: "key note",
  orphan: "needs links",
  bridge: "bridge",
  strong_pair: "strong pair",
  recent_connection: "new link",
};

// Tooltip descriptions for insight types
const insightTypeDescriptions: Record<string, string> = {
  hub: "A central note connected to many others — key to your knowledge graph",
  orphan: "This note isn't linked to anything yet. Consider adding connections.",
  bridge: "This note links different topic clusters together",
  strong_pair: "These notes have a very high similarity or connection strength",
  recent_connection: "A recently formed connection between notes",
};

// Friendly labels for connection types
const connectionTypeLabels: Record<string, { label: string; color: string }> = {
  related: { label: "Related", color: "bg-blue-500" },
  supports: { label: "Supports", color: "bg-green-500" },
  extends: { label: "Builds on", color: "bg-orange-500" },
  contradicts: { label: "Challenges", color: "bg-red-500" },
  references: { label: "References", color: "bg-purple-500" },
};

interface ConnectionHighlightsProps {
  insights: GraphInsight[];
  stats: GraphStats;
  nodes: GraphNode[];
  onNodeClick?: (node: GraphNode) => void;
  onBrowseNote?: (nodeId: string) => void;
}

export function ConnectionHighlights({
  insights,
  stats,
  nodes,
  onNodeClick,
  onBrowseNote,
}: ConnectionHighlightsProps) {
  const coveragePercent =
    stats.totalNotes > 0
      ? Math.round((stats.connectedNotes / stats.totalNotes) * 100)
      : 0;

  return (
    <div className="space-y-4 p-4">
      {/* Connection Health - Visual Progress */}
      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Connection Health</span>
        </div>

        {/* Coverage bar */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-muted-foreground">
              {stats.connectedNotes} of {stats.totalNotes} notes are connected
            </span>
            <span className={`text-sm font-bold ${
              coveragePercent >= 70 ? "text-green-500" : coveragePercent >= 40 ? "text-amber-500" : "text-red-500"
            }`}>
              {coveragePercent}%
            </span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                coveragePercent >= 70 ? "bg-green-500" : coveragePercent >= 40 ? "bg-amber-500" : "bg-red-500"
              }`}
              style={{ width: `${coveragePercent}%` }}
            />
          </div>
        </div>

        {/* Quick stats row */}
        <div className="grid grid-cols-3 gap-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="text-center cursor-help">
                <div className="text-lg font-bold text-blue-500">{stats.totalConnections}</div>
                <div className="text-[10px] text-muted-foreground">connections</div>
              </div>
            </TooltipTrigger>
            <TooltipContent>Total links between your notes (manual + AI-discovered)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="text-center cursor-help">
                <div className="text-lg font-bold">{stats.avgConnectionsPerNote}</div>
                <div className="text-[10px] text-muted-foreground">avg per note</div>
              </div>
            </TooltipTrigger>
            <TooltipContent>Average number of connections per note. Higher is better for knowledge discovery.</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="text-center cursor-help">
                <div className={`text-lg font-bold ${stats.orphanNotes > 5 ? "text-amber-500" : "text-muted-foreground"}`}>
                  {stats.orphanNotes}
                </div>
                <div className="text-[10px] text-muted-foreground">solo notes</div>
              </div>
            </TooltipTrigger>
            <TooltipContent>Notes with no connections. Add [[wikilinks]] or analyze them to connect.</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Connection Type Breakdown */}
      {stats.totalConnections > 0 && (
        <div className="rounded-lg border bg-card p-3">
          <p className="text-xs font-medium text-muted-foreground mb-2">How your notes connect</p>
          <div className="space-y-1.5">
            {Object.entries(stats.connectionsByType).map(([type, count]) => {
              const config = connectionTypeLabels[type];
              if (!config) return null;
              const percent = Math.round((count / stats.totalConnections) * 100);
              return (
                <div key={type} className="flex items-center gap-2">
                  <div className={`h-2 w-2 rounded-full shrink-0 ${config.color}`} />
                  <span className="text-xs flex-1">{config.label}</span>
                  <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${config.color}`}
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                  <span className="text-xs text-muted-foreground w-8 text-right">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Insight Cards */}
      {insights.length > 0 ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">What we found</p>
          {insights.map((insight, i) => (
            <InsightCard
              key={i}
              insight={insight}
              nodes={nodes}
              onNodeClick={onNodeClick}
              onBrowseNote={onBrowseNote}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-8 text-muted-foreground">
          <Sparkles className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm font-medium">No highlights yet</p>
          <p className="text-xs mt-1">
            Keep writing and linking notes — patterns will surface here automatically.
          </p>
        </div>
      )}
    </div>
  );
}

function InsightCard({
  insight,
  nodes,
  onNodeClick,
  onBrowseNote,
}: {
  insight: GraphInsight;
  nodes: GraphNode[];
  onNodeClick?: (node: GraphNode) => void;
  onBrowseNote?: (nodeId: string) => void;
}) {
  const relatedNodes = insight.nodeIds
    .map((id) => nodes.find((n) => n.id === id))
    .filter(Boolean) as GraphNode[];

  return (
    <div
      className={`rounded-lg border p-3 transition-colors ${insightColors[insight.type] || "border-border"}`}
    >
      <div className="flex items-start gap-2">
        <div className="mt-0.5 shrink-0">
          {insightIcons[insight.type] || <Sparkles className="h-4 w-4" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <p className="text-sm font-medium truncate">{insight.title}</p>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Badge variant="secondary" className="text-[10px] shrink-0 cursor-help">
                    {insightTypeLabels[insight.type] || insight.type.replace("_", " ")}
                  </Badge>
                </span>
              </TooltipTrigger>
              <TooltipContent>{insightTypeDescriptions[insight.type] || "A pattern found in your knowledge graph"}</TooltipContent>
            </Tooltip>
          </div>
          <p className="text-xs text-muted-foreground">{insight.description}</p>

          {/* Related note chips */}
          {relatedNodes.length > 0 && (
            <div className="flex gap-1.5 mt-2 flex-wrap">
              {relatedNodes.slice(0, 5).map((node) => (
                <button
                  key={node.id}
                  onClick={() => onNodeClick?.(node)}
                  className="inline-flex items-center gap-1 rounded-md bg-background border px-2 py-0.5 text-xs hover:bg-muted transition-colors"
                >
                  <div
                    className="h-1.5 w-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: node.projectColor }}
                  />
                  <span className="truncate max-w-[120px]">{node.title}</span>
                  <ExternalLink className="h-2.5 w-2.5 shrink-0 opacity-40" />
                </button>
              ))}
              {relatedNodes.length > 5 && (
                <span className="text-[10px] text-muted-foreground self-center">
                  +{relatedNodes.length - 5} more
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
