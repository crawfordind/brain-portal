"use client";

import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import type { GraphData, GraphNode } from "@/app/api/graph/route";
import { ConnectionHighlights } from "./connection-highlights";
import { TopicGroups } from "./topic-groups";
import { ConnectionBrowser } from "./connection-browser";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Waypoints,
  Sparkles,
  FolderTree,
  List,
  Link2,
  CircleDot,
  Unlink,
} from "lucide-react";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

export function ConnectionStation() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("highlights");

  const { data, isLoading, error } = useQuery<GraphData>({
    queryKey: ["graph"],
    queryFn: async () => {
      const response = await fetch("/api/graph");
      if (!response.ok) throw new Error("Failed to fetch connection data");
      return response.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const handleNodeClick = useCallback(
    (node: GraphNode) => {
      router.push(`/notes/${node.slug}`);
    },
    [router]
  );

  const handleBrowseNote = useCallback(
    (nodeId: string) => {
      setActiveTab("browse");
    },
    []
  );

  return (
    <div className="lg:col-span-3">
      <div className="rounded-lg border bg-card overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <Waypoints className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold">Connection Station</h2>
            </div>
            {data && (
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <CircleDot className="h-3 w-3" />
                  {data.stats.totalNotes} notes
                </span>
                <span className="flex items-center gap-1">
                  <Link2 className="h-3 w-3" />
                  {data.stats.totalConnections} connections
                </span>
                {data.stats.orphanNotes > 0 && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="flex items-center gap-1 text-amber-500 cursor-help">
                        <Unlink className="h-3 w-3" />
                        {data.stats.orphanNotes} solo
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>Unconnected notes — open them and add links to connect them</TooltipContent>
                  </Tooltip>
                )}
              </div>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            See how your notes connect, discover patterns, and find gaps
          </p>
        </div>

        {/* Tabbed Content */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="px-4 pt-2 border-b">
            <TabsList className="w-full grid grid-cols-3">
              <TabsTrigger value="highlights" className="gap-1.5">
                <Sparkles className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Highlights</span>
                {data && data.insights.length > 0 && (
                  <Badge variant="secondary" className="h-4 text-[10px] px-1 ml-0.5">
                    {data.insights.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="topics" className="gap-1.5">
                <FolderTree className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Topics</span>
                {data && data.clusters.length > 0 && (
                  <Badge variant="secondary" className="h-4 text-[10px] px-1 ml-0.5">
                    {data.clusters.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="browse" className="gap-1.5">
                <List className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Browse</span>
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Highlights Tab */}
          <TabsContent value="highlights" className="m-0">
            {isLoading ? (
              <LoadingSkeleton />
            ) : error ? (
              <ErrorState message={(error as Error).message} />
            ) : data ? (
              <div className="max-h-[60vh] overflow-y-auto">
                <ConnectionHighlights
                  insights={data.insights}
                  stats={data.stats}
                  nodes={data.nodes}
                  onNodeClick={handleNodeClick}
                  onBrowseNote={handleBrowseNote}
                />
              </div>
            ) : null}
          </TabsContent>

          {/* Topics Tab */}
          <TabsContent value="topics" className="m-0">
            {isLoading ? (
              <LoadingSkeleton />
            ) : error ? (
              <ErrorState message={(error as Error).message} />
            ) : data ? (
              <div className="max-h-[60vh] overflow-y-auto">
                <TopicGroups
                  clusters={data.clusters}
                  nodes={data.nodes}
                  links={data.links}
                  onNodeClick={handleNodeClick}
                />
              </div>
            ) : null}
          </TabsContent>

          {/* Browse Tab */}
          <TabsContent value="browse" className="m-0">
            {isLoading ? (
              <LoadingSkeleton />
            ) : error ? (
              <ErrorState message={(error as Error).message} />
            ) : data ? (
              <ConnectionBrowser
                nodes={data.nodes}
                links={data.links}
                clusters={data.clusters}
                onNodeClick={handleNodeClick}
              />
            ) : null}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="p-4 space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-20 bg-muted animate-pulse rounded-lg" />
        ))}
      </div>
      {[...Array(3)].map((_, i) => (
        <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />
      ))}
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="text-center">
        <p className="text-destructive mb-2">Couldn&apos;t load your connections</p>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}
