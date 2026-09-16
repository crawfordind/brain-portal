"use client";

import { useState } from "react";
import type { GraphCluster, GraphNode, GraphLink } from "@/app/api/graph/route";
import { Badge } from "@/components/ui/badge";
import {
  ChevronRight,
  ExternalLink,
  FolderTree,
  Link2,
  FileText,
  Puzzle,
} from "lucide-react";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

interface TopicGroupsProps {
  clusters: GraphCluster[];
  nodes: GraphNode[];
  links: GraphLink[];
  onNodeClick?: (node: GraphNode) => void;
}

export function TopicGroups({
  clusters,
  nodes,
  links,
  onNodeClick,
}: TopicGroupsProps) {
  const [expandedCluster, setExpandedCluster] = useState<string | null>(null);

  // Find orphan notes (not in any cluster and no connections)
  const clusteredNodeIds = new Set(clusters.flatMap((c) => c.nodeIds));
  const orphanNodes = nodes.filter(
    (n) => !clusteredNodeIds.has(n.id) && n.connectionCount === 0
  );

  if (clusters.length === 0 && orphanNodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
        <FolderTree className="h-10 w-10 text-muted-foreground/30 mb-3" />
        <p className="text-sm font-medium text-muted-foreground">
          No topic groups yet
        </p>
        <p className="text-xs text-muted-foreground mt-1 max-w-[280px]">
          As you write more notes and they get connected, related notes will
          automatically group into topics here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">
          {clusters.length} Topic{clusters.length !== 1 ? "s" : ""} found
        </p>
        {orphanNodes.length > 0 && (
          <Badge variant="secondary" className="text-[10px]">
            {orphanNodes.length} ungrouped
          </Badge>
        )}
      </div>

      {/* Topic Cards */}
      {clusters.map((cluster) => {
        const isExpanded = expandedCluster === cluster.id;
        const clusterNodes = cluster.nodeIds
          .map((id) => nodes.find((n) => n.id === id))
          .filter(Boolean) as GraphNode[];

        // Count internal connections
        const clusterNodeSet = new Set(cluster.nodeIds);
        const internalLinks = links.filter(
          (l) => clusterNodeSet.has(l.source) && clusterNodeSet.has(l.target)
        );

        return (
          <div
            key={cluster.id}
            className="rounded-lg border bg-card overflow-hidden transition-shadow hover:shadow-sm"
          >
            {/* Topic Header */}
            <button
              onClick={() =>
                setExpandedCluster(isExpanded ? null : cluster.id)
              }
              className="w-full p-3 flex items-center gap-3 hover:bg-muted/50 transition-colors"
            >
              {/* Color indicator */}
              <div
                className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0"
                style={{ backgroundColor: `${cluster.color}15` }}
              >
                <FolderTree
                  className="h-4 w-4"
                  style={{ color: cluster.color }}
                />
              </div>

              <div className="flex-1 min-w-0 text-left">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">
                    {cluster.label}
                  </span>
                  <Badge
                    variant="secondary"
                    className="text-[10px] shrink-0"
                  >
                    {cluster.nodeIds.length} notes
                  </Badge>
                </div>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <Link2 className="h-2.5 w-2.5" />
                    {internalLinks.length} connections
                  </span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="text-[10px] text-muted-foreground cursor-help">
                        {Math.round(cluster.connectionDensity * 100)}% interconnected
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>How densely linked the notes in this topic are — 100% means every note links to every other</TooltipContent>
                  </Tooltip>
                </div>
              </div>

              <ChevronRight
                className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform ${
                  isExpanded ? "rotate-90" : ""
                }`}
              />
            </button>

            {/* Expanded Content */}
            {isExpanded && (
              <div className="border-t px-3 py-2 space-y-1">
                {clusterNodes.slice(0, 10).map((node) => (
                  <button
                    key={node.id}
                    onClick={() => onNodeClick?.(node)}
                    className="w-full flex items-center gap-2 p-1.5 rounded-md hover:bg-muted/50 transition-colors text-left group"
                  >
                    <div
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: node.projectColor }}
                    />
                    <span className="text-xs truncate flex-1">
                      {node.title}
                    </span>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {node.connectionCount} {node.connectionCount === 1 ? "link" : "links"}
                    </span>
                    <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                  </button>
                ))}
                {clusterNodes.length > 10 && (
                  <p className="text-[10px] text-muted-foreground text-center py-1">
                    +{clusterNodes.length - 10} more notes
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Lonely Notes Section */}
      {orphanNodes.length > 0 && (
        <div className="rounded-lg border border-dashed bg-muted/30 p-3">
          <div className="flex items-center gap-2 mb-2">
            <Puzzle className="h-4 w-4 text-amber-500" />
            <span className="text-sm font-medium text-muted-foreground">
              Lonely Notes
            </span>
          </div>
          <p className="text-xs text-muted-foreground mb-2">
            These notes aren&apos;t connected to anything yet. Opening them and
            adding links (like [[other note]]) will help them find their group.
          </p>
          <div className="flex gap-1.5 flex-wrap">
            {orphanNodes.slice(0, 8).map((node) => (
              <button
                key={node.id}
                onClick={() => onNodeClick?.(node)}
                className="inline-flex items-center gap-1 rounded-md bg-background border px-2 py-0.5 text-xs hover:bg-muted transition-colors"
              >
                <span className="truncate max-w-[100px]">{node.title}</span>
              </button>
            ))}
            {orphanNodes.length > 8 && (
              <span className="text-[10px] text-muted-foreground self-center">
                +{orphanNodes.length - 8} more
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
