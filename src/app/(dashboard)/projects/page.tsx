"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LazyDialog } from "@/components/ui/lazy-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus, FolderOpen, Star, FileText, CheckSquare, ChevronRight, ChevronDown, Folder, Users } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

interface Project {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  color: string | null;
  icon: string | null;
  priority: number;
  parent_id: string | null;
  note_count: number;
  open_task_count: number;
  created_at: string;
  updated_at: string;
}

interface ProjectNode extends Project {
  children: ProjectNode[];
  depth: number;
}

function buildProjectTree(projects: Project[]): ProjectNode[] {
  const projectMap = new Map<string, ProjectNode>();
  const roots: ProjectNode[] = [];

  // Create nodes for all projects
  for (const project of projects) {
    projectMap.set(project.id, { ...project, children: [], depth: 0 });
  }

  // Build tree structure
  for (const project of projects) {
    const node = projectMap.get(project.id)!;
    if (project.parent_id && projectMap.has(project.parent_id)) {
      const parent = projectMap.get(project.parent_id)!;
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Calculate depths
  function setDepth(nodes: ProjectNode[], depth: number) {
    for (const node of nodes) {
      node.depth = depth;
      setDepth(node.children, depth + 1);
    }
  }
  setDepth(roots, 0);

  // Sort children by name
  function sortChildren(nodes: ProjectNode[]) {
    nodes.sort((a, b) => a.name.localeCompare(b.name));
    for (const node of nodes) {
      sortChildren(node.children);
    }
  }
  sortChildren(roots);

  return roots;
}

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-500/10 text-green-600 border-green-500/20",
  planning: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  stalled: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20",
  completed: "bg-gray-500/10 text-gray-600 border-gray-500/20",
  archived: "bg-gray-400/10 text-gray-400 border-gray-400/20",
};

const STATUS_DOT_COLORS: Record<string, string> = {
  active: "bg-green-500",
  planning: "bg-blue-500",
  stalled: "bg-yellow-500",
  completed: "bg-gray-500",
  archived: "bg-gray-400",
};

export default function ProjectsPage() {
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const response = await fetch("/api/projects?includeArchived=true");
      if (!response.ok) throw new Error("Failed to fetch projects");
      return response.json();
    },
  });

  const togglePriorityMutation = useMutation({
    mutationFn: async ({ id, priority }: { id: string; priority: number }) => {
      const response = await fetch(`/api/projects/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priority }),
      });
      if (!response.ok) throw new Error("Failed to update");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const projects = data?.projects as Project[] || [];
  const sharedProjects = (data?.sharedProjects || []) as (Project & { collab_role: string; owner_email: string })[];
  const projectTree = buildProjectTree(projects);

  // Separate pinned (top-level only) and filter archived
  const pinnedProjects = projectTree.filter((p) => p.priority > 0);
  const activeTree = projectTree.filter((p) => p.priority === 0 && p.status !== "archived");
  const archivedTree = projectTree.filter((p) => p.status === "archived");

  if (isLoading) {
    return (
      <div className="p-3 lg:p-6 space-y-4 lg:space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-6 lg:h-8 w-24 lg:w-32" />
          <Skeleton className="h-9 lg:h-10 w-28 lg:w-32" />
        </div>
        <div className="grid gap-3 lg:gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 lg:h-40" />
          ))}
        </div>
      </div>
    );
  }

  const renderProjectNode = (node: ProjectNode): React.ReactNode => {
    const isExpanded = expandedIds.has(node.id);
    const hasChildren = node.children.length > 0;

    return (
      <div key={node.id}>
        {/* TOUCH: min-h-12 for comfortable tapping on mobile, reduced indent */}
        <div
          className="group flex items-center gap-2 py-1.5 lg:py-2 px-2 lg:px-3 rounded-lg hover:bg-muted/50 transition-colors min-h-11 lg:min-h-10"
          style={{ paddingLeft: `${node.depth * 12 + 8}px` }}
        >
          {/* Expand/collapse button - TOUCH: Larger tap target */}
          {hasChildren ? (
            <button
              onClick={() => toggleExpanded(node.id)}
              className="p-1 lg:p-0.5 hover:bg-muted rounded min-w-7 min-h-7 lg:min-w-5 lg:min-h-5 flex items-center justify-center"
            >
              {isExpanded ? (
                <ChevronDown className="h-3 w-3 lg:h-4 lg:w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-3 w-3 lg:h-4 lg:w-4 text-muted-foreground" />
              )}
            </button>
          ) : (
            <span className="w-7 lg:w-5" />
          )}

          {/* Folder icon */}
          {hasChildren ? (
            <FolderOpen className="h-3 w-3 lg:h-4 lg:w-4 text-muted-foreground shrink-0" />
          ) : (
            <Folder className="h-3 w-3 lg:h-4 lg:w-4 text-muted-foreground shrink-0" />
          )}

          {/* Project link */}
          <Link
            href={`/projects/${node.slug}`}
            className="flex-1 flex items-center gap-2 min-w-0"
          >
            <span className="font-medium truncate text-xs lg:text-sm">{node.name}</span>
            <span className={`h-2 w-2 rounded-full shrink-0 sm:hidden ${STATUS_DOT_COLORS[node.status] || "bg-gray-400"}`} title={node.status} />
            <Badge variant="outline" className={`${STATUS_COLORS[node.status]} shrink-0 text-[10px] lg:text-xs hidden sm:inline-flex`}>
              {node.status}
            </Badge>
          </Link>

          {/* Stats - MOBILE: Simplified on small screens */}
          <div className="flex items-center gap-1.5 lg:gap-2 text-xs text-muted-foreground shrink-0">
            <div className="flex items-center gap-0.5 lg:gap-1">
              <FileText className="h-3 w-3" />
              <span className="text-[10px] lg:text-xs">{node.note_count}</span>
            </div>
            {/* MOBILE: Hide task count on very small screens */}
            <div className="items-center gap-0.5 lg:gap-1 hidden sm:flex">
              <CheckSquare className="h-3 w-3" />
              <span className="text-[10px] lg:text-xs">{node.open_task_count}</span>
            </div>
            {/* TOUCH: Always visible on mobile, hover reveal on desktop */}
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                togglePriorityMutation.mutate({
                  id: node.id,
                  priority: node.priority > 0 ? 0 : 1,
                });
              }}
              className="p-1 hover:bg-muted rounded opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity min-w-7 min-h-7 lg:min-w-6 lg:min-h-6 flex items-center justify-center"
            >
              <Star
                className={`h-3 w-3 lg:h-4 lg:w-4 ${
                  node.priority > 0 ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"
                }`}
              />
            </button>
          </div>
        </div>

        {/* Children */}
        {hasChildren && isExpanded && (
          <div>
            {node.children.map(renderProjectNode)}
          </div>
        )}
      </div>
    );
  };

  const renderProjectCard = (project: ProjectNode) => (
    <Link href={`/projects/${project.slug}`} key={project.id}>
      {/* TOUCH: min-h ensures comfortable tap target */}
      <Card className="h-full hover:bg-muted/50 transition-colors cursor-pointer min-h-[110px] lg:min-h-[120px]">
        <CardHeader className="pb-2 p-3 lg:p-6 lg:pb-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <FolderOpen className="h-4 w-4 lg:h-5 lg:w-5 text-muted-foreground shrink-0" />
              <CardTitle className="text-sm lg:text-base truncate">{project.name}</CardTitle>
            </div>
            {/* TOUCH: Larger button on mobile */}
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                togglePriorityMutation.mutate({
                  id: project.id,
                  priority: project.priority > 0 ? 0 : 1,
                });
              }}
              className="p-1.5 lg:p-1 hover:bg-muted rounded min-w-8 min-h-8 lg:min-w-6 lg:min-h-6 flex items-center justify-center shrink-0"
            >
              <Star
                className={`h-3 w-3 lg:h-4 lg:w-4 ${
                  project.priority > 0 ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"
                }`}
              />
            </button>
          </div>
          {project.description && (
            <CardDescription className="line-clamp-2 text-xs lg:text-sm mt-1">
              {project.description}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="p-3 pt-0 lg:p-6 lg:pt-0">
          {/* MOBILE: Wrap on small screens */}
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline" className={`${STATUS_COLORS[project.status]} text-[10px] lg:text-xs`}>
              {project.status}
            </Badge>
            <div className="flex items-center gap-1">
              <FileText className="h-3 w-3" />
              {project.note_count}
            </div>
            <div className="flex items-center gap-1">
              <CheckSquare className="h-3 w-3" />
              {project.open_task_count}
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );

  return (
    <div className="p-3 lg:p-6 space-y-4 lg:space-y-6">
      {/* Header - MOBILE: Stack on small screens */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          {/* RESPONSIVE: Smaller title on mobile */}
          <h1 className="text-xl font-bold lg:text-2xl">Projects</h1>
          <p className="text-xs lg:text-sm text-muted-foreground">
            Organize your notes and tasks by project
          </p>
        </div>
        {/* TOUCH: min-h-11 for comfortable tapping on mobile */}
        <Button
          onClick={() => setIsCreateOpen(true)}
          className="w-full sm:w-auto h-9 lg:h-10 text-xs lg:text-sm"
        >
          <Plus className="h-3 w-3 lg:h-4 lg:w-4 mr-2" />
          New Project
        </Button>
      </div>

      <LazyDialog
        open={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        loader={() => import('@/components/projects/project-create-dialog').then(m => ({ default: m.ProjectCreateDialog }))}
      />

      {/* Pinned Projects - shown as cards */}
      {pinnedProjects.length > 0 && (
        <section>
          <h2 className="text-base lg:text-lg font-semibold mb-3 lg:mb-4 flex items-center gap-2">
            <Star className="h-3 w-3 lg:h-4 lg:w-4 fill-yellow-400 text-yellow-400" />
            Pinned
          </h2>
          <div className="grid gap-3 lg:gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {pinnedProjects.map(renderProjectCard)}
          </div>
        </section>
      )}

      {/* Project Tree */}
      {activeTree.length > 0 && (
        <section>
          <h2 className="text-base lg:text-lg font-semibold mb-3 lg:mb-4">Projects</h2>
          <Card>
            <CardContent className="p-1 lg:p-2">
              {activeTree.map(renderProjectNode)}
            </CardContent>
          </Card>
        </section>
      )}

      {/* Shared With Me */}
      {sharedProjects.length > 0 && (
        <section>
          <h2 className="text-base lg:text-lg font-semibold mb-3 lg:mb-4 flex items-center gap-2">
            <Users className="h-3 w-3 lg:h-4 lg:w-4 text-muted-foreground" />
            Shared With Me
          </h2>
          <Card>
            <CardContent className="p-1 lg:p-2">
              {sharedProjects.map((sp) => (
                <div key={sp.id}>
                  <div className="group flex items-center gap-2 py-1.5 lg:py-2 px-2 lg:px-3 rounded-lg hover:bg-muted/50 transition-colors min-h-11 lg:min-h-10">
                    <span className="w-7 lg:w-5" />
                    <Folder className="h-3 w-3 lg:h-4 lg:w-4 text-muted-foreground shrink-0" />
                    <Link
                      href={`/projects/${sp.slug}`}
                      className="flex-1 flex items-center gap-2 min-w-0"
                    >
                      <span className="font-medium truncate text-xs lg:text-sm">{sp.name}</span>
                      <span className={`h-2 w-2 rounded-full shrink-0 sm:hidden ${STATUS_DOT_COLORS[sp.status] || "bg-gray-400"}`} title={sp.status} />
                      <Badge variant="outline" className={`${STATUS_COLORS[sp.status]} shrink-0 text-[10px] lg:text-xs hidden sm:inline-flex`}>
                        {sp.status}
                      </Badge>
                      <Badge variant="secondary" className="shrink-0 text-[10px] lg:text-xs capitalize">
                        {sp.collab_role}
                      </Badge>
                    </Link>
                    <div className="flex items-center gap-1.5 lg:gap-2 text-xs text-muted-foreground shrink-0">
                      <span className="text-[10px] lg:text-xs truncate max-w-[100px] hidden sm:inline">
                        {sp.owner_email}
                      </span>
                      <div className="flex items-center gap-0.5 lg:gap-1">
                        <FileText className="h-3 w-3" />
                        <span className="text-[10px] lg:text-xs">{(sp as unknown as { note_count: number }).note_count}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      )}

      {/* Archived Projects */}
      {archivedTree.length > 0 && (
        <section>
          <h2 className="text-base lg:text-lg font-semibold mb-3 lg:mb-4 text-muted-foreground">
            Archived
          </h2>
          <Card>
            <CardContent className="p-1 lg:p-2">
              {archivedTree.map(renderProjectNode)}
            </CardContent>
          </Card>
        </section>
      )}

      {/* Empty State */}
      {projects.length === 0 && (
        <div className="flex flex-col items-center justify-center py-8 lg:py-12 text-center">
          <FolderOpen className="h-8 w-8 lg:h-12 lg:w-12 text-muted-foreground mb-3 lg:mb-4" />
          <h2 className="text-lg lg:text-xl font-semibold mb-2">No projects yet</h2>
          <p className="text-xs lg:text-sm text-muted-foreground mb-3 lg:mb-4 px-4">
            Create your first project to start organizing your notes.
          </p>
          <Button onClick={() => setIsCreateOpen(true)} className="h-9 lg:h-10 text-xs lg:text-sm">
            <Plus className="h-3 w-3 lg:h-4 lg:w-4 mr-2" />
            Create Project
          </Button>
        </div>
      )}
    </div>
  );
}
