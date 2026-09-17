"use client";

import { useState, useMemo } from "react";
import type { GraphNode, GraphLink, GraphCluster } from "@/app/api/graph/route";
import { Badge } from "@/components/ui/badge";
import {
  Search,
  X,
  Filter,
  ChevronDown,
  ExternalLink,
  Link2,
  ArrowRight,
  ArrowLeft,
  Waypoints,
} from "lucide-react";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

// Friendly connection type labels and colors
const connectionInfo: Record<string, { label: string; color: string; bgColor: string }> = {
  related: { label: "Related", color: "text-blue-500", bgColor: "bg-blue-500/10" },
  supports: { label: "Supports", color: "text-green-500", bgColor: "bg-green-500/10" },
  extends: { label: "Builds on", color: "text-orange-500", bgColor: "bg-orange-500/10" },
  contradicts: { label: "Challenges", color: "text-red-500", bgColor: "bg-red-500/10" },
  references: { label: "References", color: "text-purple-500", bgColor: "bg-purple-500/10" },
};

interface ConnectionBrowserProps {
  nodes: GraphNode[];
  links: GraphLink[];
  clusters: GraphCluster[];
  onNodeClick?: (node: GraphNode) => void;
}

export function ConnectionBrowser({
  nodes,
  links,
  clusters,
  onNodeClick,
}: ConnectionBrowserProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<"connections" | "recent" | "name">("connections");
  const [expandedNodeId, setExpandedNodeId] = useState<string | null>(null);

  // Extract unique projects
  const projects = useMemo(() => {
    const map = new Map<string, { id: string; name: string; color: string }>();
    for (const node of nodes) {
      if (node.projectId && node.projectName) {
        map.set(node.projectId, {
          id: node.projectId,
          name: node.projectName,
          color: node.projectColor,
        });
      }
    }
    return [...map.values()];
  }, [nodes]);

  // Filter and sort nodes
  const filteredNodes = useMemo(() => {
    let result = [...nodes];

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter((n) => n.title.toLowerCase().includes(query));
    }

    // Project filter
    if (selectedProjects.length > 0) {
      result = result.filter(
        (n) => n.projectId && selectedProjects.includes(n.projectId)
      );
    }

    // Sort
    switch (sortBy) {
      case "connections":
        result.sort((a, b) => b.connectionCount - a.connectionCount);
        break;
      case "recent":
        result.sort((a, b) => {
          const aDate = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
          const bDate = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
          return bDate - aDate;
        });
        break;
      case "name":
        result.sort((a, b) => a.title.localeCompare(b.title));
        break;
    }

    return result;
  }, [nodes, searchQuery, selectedProjects, sortBy]);

  // Get connections for a specific node
  const getNodeConnections = (nodeId: string) => {
    return links
      .filter((l) => l.source === nodeId || l.target === nodeId)
      .map((link) => {
        const isSource = link.source === nodeId;
        const connectedId = isSource ? link.target : link.source;
        const connectedNode = nodes.find((n) => n.id === connectedId);
        return {
          node: connectedNode,
          link,
          direction: isSource ? ("outgoing" as const) : ("incoming" as const),
        };
      })
      .filter((c) => c.node)
      .sort((a, b) => b.link.strength - a.link.strength);
  };

  const hasActiveFilters = selectedProjects.length > 0 || searchQuery.length > 0;

  return (
    <div className="flex flex-col max-h-[60vh]">
      {/* Search & Filter Bar */}
      <div className="p-3 border-b space-y-2 shrink-0">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search your notes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bp-field pl-8 pr-8 text-sm"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`px-2.5 py-1.5 rounded-md border text-sm flex items-center gap-1.5 transition-colors ${
              hasActiveFilters
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background hover:bg-muted"
            }`}
          >
            <Filter className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Filter</span>
          </button>
        </div>

        {/* Filter Panel */}
        {showFilters && (
          <div className="space-y-2 pt-1">
            {/* Sort */}
            <div>
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">
                Sort by
              </p>
              <div className="flex gap-1.5">
                {([
                  { value: "connections", label: "Most connected" },
                  { value: "recent", label: "Recently updated" },
                  { value: "name", label: "Name" },
                ] as const).map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => setSortBy(value)}
                    className={`px-2 py-0.5 rounded-full text-xs border transition-colors ${
                      sortBy === value
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background hover:bg-muted border-border"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Project Filters */}
            {projects.length > 0 && (
              <div>
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">
                  Projects
                </p>
                <div className="flex gap-1.5 flex-wrap">
                  {projects.map((project) => (
                    <button
                      key={project.id}
                      onClick={() =>
                        setSelectedProjects((prev) =>
                          prev.includes(project.id)
                            ? prev.filter((id) => id !== project.id)
                            : [...prev, project.id]
                        )
                      }
                      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs border transition-colors ${
                        selectedProjects.includes(project.id)
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background hover:bg-muted border-border"
                      }`}
                    >
                      <div
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: project.color }}
                      />
                      {project.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {hasActiveFilters && (
              <button
                onClick={() => {
                  setSelectedProjects([]);
                  setSearchQuery("");
                }}
                className="text-xs text-primary hover:text-primary/80 font-medium"
              >
                Clear all filters
              </button>
            )}
          </div>
        )}
      </div>

      {/* Results count */}
      <div className="px-3 py-2 border-b text-xs text-muted-foreground shrink-0">
        {filteredNodes.length} note{filteredNodes.length !== 1 ? "s" : ""}
        {hasActiveFilters && " (filtered)"}
      </div>

      {/* Note List */}
      <div className="overflow-y-auto flex-1">
        {filteredNodes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <Search className="h-8 w-8 text-muted-foreground/30 mb-2" />
            <p className="text-sm text-muted-foreground">No notes found</p>
          </div>
        ) : (
          <div className="divide-y">
            {filteredNodes.map((node) => {
              const isExpanded = expandedNodeId === node.id;
              const connections = isExpanded ? getNodeConnections(node.id) : [];

              return (
                <div key={node.id} className="group">
                  {/* Note Row */}
                  <div className="flex items-center gap-2 px-3 py-2.5 hover:bg-muted/50 transition-colors">
                    {/* Project color dot */}
                    <div
                      className="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: node.projectColor }}
                    />

                    {/* Title & meta */}
                    <div className="flex-1 min-w-0">
                      <button
                        onClick={() => onNodeClick?.(node)}
                        className="text-sm font-medium truncate block w-full text-left hover:text-primary transition-colors"
                      >
                        {node.title}
                      </button>
                      <div className="flex items-center gap-2 mt-0.5">
                        {node.projectName && (
                          <span className="text-[10px] text-muted-foreground">
                            {node.projectName}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Connection count badge */}
                    {node.connectionCount > 0 ? (
                      <button
                        onClick={() =>
                          setExpandedNodeId(isExpanded ? null : node.id)
                        }
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-colors ${
                          isExpanded
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-muted/50 hover:bg-muted border-border"
                        }`}
                      >
                        <Link2 className="h-3 w-3" />
                        {node.connectionCount}
                        <ChevronDown
                          className={`h-3 w-3 transition-transform ${
                            isExpanded ? "rotate-180" : ""
                          }`}
                        />
                      </button>
                    ) : (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="text-[10px] text-muted-foreground/60 px-2 cursor-help">
                            no links
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>This note has no connections yet. Add [[wikilinks]] or let AI discover them.</TooltipContent>
                      </Tooltip>
                    )}
                  </div>

                  {/* Expanded connections */}
                  {isExpanded && connections.length > 0 && (
                    <div className="bg-muted/30 border-t px-3 py-2 space-y-1">
                      {connections.map(({ node: connectedNode, link, direction }) => {
                        if (!connectedNode) return null;
                        const info = connectionInfo[link.type] || connectionInfo.related;
                        return (
                          <button
                            key={connectedNode.id}
                            onClick={() => onNodeClick?.(connectedNode)}
                            className="w-full flex items-center gap-2 p-1.5 rounded-md hover:bg-background transition-colors text-left group/item"
                          >
                            {/* Direction arrow */}
                            {direction === "outgoing" ? (
                              <ArrowRight className={`h-3 w-3 shrink-0 ${info.color}`} />
                            ) : (
                              <ArrowLeft className={`h-3 w-3 shrink-0 ${info.color}`} />
                            )}

                            {/* Connection type tag */}
                            <span
                              className={`text-[10px] px-1.5 py-0.5 rounded ${info.bgColor} ${info.color} shrink-0`}
                            >
                              {info.label}
                            </span>

                            {/* Connected note title */}
                            <div
                              className="h-1.5 w-1.5 rounded-full shrink-0"
                              style={{ backgroundColor: connectedNode.projectColor }}
                            />
                            <span className="text-xs truncate flex-1">
                              {connectedNode.title}
                            </span>

                            {/* Strength indicator */}
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="text-[10px] text-muted-foreground shrink-0 cursor-help">
                                  {Math.round(link.strength * 100)}%
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>Connection strength — how closely these notes are related</TooltipContent>
                            </Tooltip>

                            {/* Manual vs AI badge */}
                            {!link.isManual && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="text-[9px] text-muted-foreground/60 shrink-0 cursor-help">
                                    AI
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>Auto-discovered by AI via semantic similarity</TooltipContent>
                              </Tooltip>
                            )}

                            <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 group-hover/item:opacity-100 transition-opacity shrink-0" />
                          </button>
                        );
                      })}

                      {/* Reason text if available */}
                      {connections.some((c) => c.link.reason) && (
                        <div className="pt-1 mt-1 border-t border-border/50">
                          {connections
                            .filter((c) => c.link.reason)
                            .slice(0, 2)
                            .map(({ node: cn, link }) => (
                              <p
                                key={cn?.id}
                                className="text-[10px] text-muted-foreground italic px-1.5"
                              >
                                &ldquo;{link.reason}&rdquo;
                              </p>
                            ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
