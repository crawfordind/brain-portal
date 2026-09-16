"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  MoreHorizontal,
  Star,
  Trash2,
  FileText,
  CheckSquare,
  Plus,
  Edit2,
  Save,
  X,
  BarChart,
  FolderOpen,
  Activity,
  Package,
  Bot,
  Lightbulb,
  Target,
  Network,
  Users,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import Link from "next/link";
import { SaveStatus } from "@/components/ui/save-status";
import { useAutoSave } from "@/hooks/use-auto-save";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { StatsGrid } from "@/components/projects/stats-grid";
import { ProjectTree } from "@/components/projects/project-tree";
import { ActivityTimeline } from "@/components/projects/activity-timeline";
import { CapturesCard } from "@/components/projects/captures-card";
import { AgentTasksCard } from "@/components/projects/agent-tasks-card";
import { InsightsCard } from "@/components/projects/insights-card";
import { TaskRecommendationsCard } from "@/components/projects/task-recommendations-card";
import { NoteConnectionsCard } from "@/components/projects/note-connections-card";
import { ProjectHealthCard } from "@/components/projects/project-health-card";
import { CollaboratorsCard } from "@/components/projects/collaborators-card";
import { useInView } from 'react-intersection-observer';
import { useConfirm } from "@/components/ui/confirm-dialog";

interface Project {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  color: string | null;
  icon: string | null;
  priority: number;
  created_at: string;
  updated_at: string;
}

interface Note {
  id: string;
  title: string;
  slug: string;
  note_type: string;
  word_count: number;
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
}

interface Task {
  id: string;
  content: string;
  status: string;
  priority: number;
  due_date: string | null;
  created_at: string;
}

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-500/10 text-green-600 border-green-500/20",
  planning: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  stalled: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20",
  completed: "bg-gray-500/10 text-gray-600 border-gray-500/20",
  archived: "bg-gray-400/10 text-gray-400 border-gray-400/20",
};

const TASK_STATUS_COLORS: Record<string, string> = {
  todo: "bg-gray-100 text-gray-700",
  in_progress: "bg-blue-100 text-blue-700",
  waiting: "bg-yellow-100 text-yellow-700",
  completed: "bg-green-100 text-green-700 line-through",
};

export default function ProjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const slug = params.slug as string;

  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({ name: "", description: "", status: "" });

  const { data, isLoading, error } = useQuery({
    queryKey: ["project", slug],
    queryFn: async () => {
      // The [id] endpoint accepts either a UUID or a slug, so this is a
      // single round-trip instead of list-all-then-fetch-by-id.
      const response = await fetch(`/api/projects/${encodeURIComponent(slug)}`);
      if (!response.ok) {
        if (response.status === 404) throw new Error("Project not found");
        throw new Error("Failed to fetch project");
      }
      return response.json();
    },
  });

  const project = data?.project as Project | undefined;
  const projectRole = (data?.role || "owner") as "owner" | "editor" | "viewer";
  const notes = data?.notes as Note[] || [];
  const tasks = data?.tasks as Task[] || [];

  // Fetch project stats
  const { data: statsData } = useQuery({
    queryKey: ["project-stats", project?.id],
    queryFn: async () => {
      if (!project?.id) return null;
      const response = await fetch(`/api/projects/${project.id}/stats`);
      if (!response.ok) throw new Error("Failed to fetch stats");
      return response.json();
    },
    enabled: !!project?.id,
  });

  const stats = statsData?.stats;

  // Fetch sub-projects
  const { data: subProjectsData } = useQuery({
    queryKey: ["project-subprojects", project?.id],
    queryFn: async () => {
      if (!project?.id) return null;
      const response = await fetch(`/api/projects/${project.id}/subprojects`);
      if (!response.ok) throw new Error("Failed to fetch sub-projects");
      return response.json();
    },
    enabled: !!project?.id,
  });

  const subProjects = subProjectsData?.subprojects || [];

  // Intersection observer for lazy loading activities
  const { ref: activityRef, inView: activityInView } = useInView({
    triggerOnce: true,
    threshold: 0.1,
  });

  // Fetch activities with lazy loading
  const { data: activitiesData } = useQuery({
    queryKey: ["project-activities", project?.id],
    queryFn: async () => {
      if (!project?.id) return null;
      const response = await fetch(`/api/projects/${project.id}/activities?limit=50`);
      if (!response.ok) throw new Error("Failed to fetch activities");
      return response.json();
    },
    enabled: !!project?.id && activityInView,
  });

  const activities = activitiesData?.activities || [];

  // Intersection observer for lazy loading captures
  const { ref: capturesRef, inView: capturesInView } = useInView({
    triggerOnce: true,
    threshold: 0.1,
  });

  // Fetch captures with lazy loading
  const { data: capturesData } = useQuery({
    queryKey: ["project-captures", project?.id],
    queryFn: async () => {
      if (!project?.id) return null;
      const response = await fetch(`/api/projects/${project.id}/captures`);
      if (!response.ok) throw new Error("Failed to fetch captures");
      return response.json();
    },
    enabled: !!project?.id && capturesInView,
  });

  const captures = capturesData?.captures || [];

  // Intersection observer for lazy loading agent tasks
  const { ref: agentTasksRef, inView: agentTasksInView } = useInView({
    triggerOnce: true,
    threshold: 0.1,
  });

  // Fetch agent tasks with lazy loading
  const { data: agentTasksData } = useQuery({
    queryKey: ["project-agent-tasks", project?.id],
    queryFn: async () => {
      if (!project?.id) return null;
      const response = await fetch(`/api/projects/${project.id}/agent-tasks`);
      if (!response.ok) throw new Error("Failed to fetch agent tasks");
      return response.json();
    },
    enabled: !!project?.id && agentTasksInView,
  });

  const agentTasks = agentTasksData?.agentTasks || [];

  // Intersection observer for lazy loading insights
  const { ref: insightsRef, inView: insightsInView } = useInView({
    triggerOnce: true,
    threshold: 0.1,
  });

  // Fetch insights with lazy loading
  const { data: insightsData } = useQuery({
    queryKey: ["project-insights", project?.id],
    queryFn: async () => {
      if (!project?.id) return null;
      const response = await fetch(`/api/projects/${project.id}/insights`);
      if (!response.ok) throw new Error("Failed to fetch insights");
      return response.json();
    },
    enabled: !!project?.id && insightsInView,
  });

  const insights = insightsData?.insights || [];

  // Intersection observer for lazy loading recommendations
  const { ref: recommendationsRef, inView: recommendationsInView } = useInView({
    triggerOnce: true,
    threshold: 0.1,
  });

  // Fetch recommendations with lazy loading
  const { data: recommendationsData } = useQuery({
    queryKey: ["project-recommendations", project?.id],
    queryFn: async () => {
      if (!project?.id) return null;
      const response = await fetch(`/api/projects/${project.id}/recommendations`);
      if (!response.ok) throw new Error("Failed to fetch recommendations");
      return response.json();
    },
    enabled: !!project?.id && recommendationsInView,
  });

  const recommendations = recommendationsData?.recommendations || [];

  // Intersection observer for lazy loading connections
  const { ref: connectionsRef, inView: connectionsInView } = useInView({
    triggerOnce: true,
    threshold: 0.1,
  });

  // Fetch connections with lazy loading
  const { data: connectionsData } = useQuery({
    queryKey: ["project-connections", project?.id],
    queryFn: async () => {
      if (!project?.id) return null;
      const response = await fetch(`/api/projects/${project.id}/connections`);
      if (!response.ok) throw new Error("Failed to fetch connections");
      return response.json();
    },
    enabled: !!project?.id && connectionsInView,
  });

  const connections = connectionsData?.connections || [];

  // Auto-save for project edits
  const autoSave = useAutoSave({
    data: editForm,
    onSave: async (data) => {
      if (!project?.id) return;

      const response = await fetch(`/api/projects/${project.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.name,
          description: data.description,
          status: data.status,
        }),
      });
      if (!response.ok) throw new Error("Failed to update");

      // Only invalidate projects list, not current project to preserve cursor position
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    delay: 1000,
    enabled: isEditing && !!project?.id, // Only enable when in edit mode
  });

  const updateMutation = useMutation({
    mutationFn: async (updates: Partial<Project>) => {
      const response = await fetch(`/api/projects/${project?.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!response.ok) throw new Error("Failed to update");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project", slug] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Project updated");
      setIsEditing(false);
    },
    onError: () => {
      toast.error("Failed to update project");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/projects/${project?.id}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Failed to delete");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Project deleted");
      router.push("/projects");
    },
    onError: () => {
      toast.error("Failed to delete project");
    },
  });

  const toggleTaskMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const response = await fetch(`/api/tasks/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error("Failed to update task");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project", slug] });
    },
  });

  const startEditing = () => {
    if (project) {
      setEditForm({
        name: project.name,
        description: project.description || "",
        status: project.status,
      });
      setIsEditing(true);
    }
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setEditForm({ name: "", description: "", status: "" });
  };

  const saveEdits = () => {
    // Cancel any pending auto-save
    autoSave.cancelPending();

    updateMutation.mutate({
      name: editForm.name,
      description: editForm.description,
      status: editForm.status,
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10" />
          <Skeleton className="h-8 flex-1" />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <h2 className="text-xl font-semibold mb-2">Project not found</h2>
        <p className="text-muted-foreground mb-4">
          This project may have been deleted.
        </p>
        <Button asChild>
          <Link href="/projects">Back to Projects</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header - MOBILE: Stack on small screens */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-2 sm:gap-4 flex-1 min-w-0">
          {/* TOUCH: Larger back button on mobile */}
          <Button variant="ghost" size="icon" asChild className="min-h-10 min-w-10 md:min-h-9 md:min-w-9 shrink-0">
            <Link href="/projects">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>

          {isEditing ? (
            <div className="flex-1 space-y-4 min-w-0">
              <Input
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                className="text-lg md:text-xl font-semibold"
              />
              <Textarea
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                placeholder="Project description..."
                rows={2}
              />
              <Select
                value={editForm.status}
                onValueChange={(value) => setEditForm({ ...editForm, status: value })}
              >
                <SelectTrigger className="w-full sm:w-40 min-h-11 md:min-h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="planning">Planning</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="stalled">Stalled</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="min-w-0">
              {/* RESPONSIVE: Wrap badge on mobile */}
              <div className="flex flex-wrap items-center gap-2 md:gap-3 mb-2">
                <h1 className="text-xl md:text-2xl font-bold truncate">{project.name}</h1>
                <Badge variant="outline" className={STATUS_COLORS[project.status]}>
                  {project.status}
                </Badge>
                {projectRole !== "owner" && (
                  <Badge variant="secondary" className="capitalize text-xs">
                    Shared ({projectRole})
                  </Badge>
                )}
              </div>
              {project.description && (
                <p className="text-sm md:text-base text-muted-foreground">{project.description}</p>
              )}
              <p className="text-xs md:text-sm text-muted-foreground mt-2">
                Created {format(new Date(project.created_at), "MMM d, yyyy")}
              </p>
            </div>
          )}
        </div>

        {/* Action buttons - MOBILE: Full width row on small screens */}
        <div className="flex items-center gap-2 justify-end">
          {isEditing ? (
            <>
              {/* Save status indicator */}
              <SaveStatus status={autoSave.status} lastSaved={autoSave.lastSaved} />
              {/* TOUCH: Larger buttons on mobile */}
              <Button variant="outline" size="icon" onClick={cancelEditing} className="min-h-11 min-w-11 md:min-h-9 md:min-w-9">
                <X className="h-4 w-4" />
              </Button>
              <Button onClick={saveEdits} disabled={updateMutation.isPending} className="min-h-11 md:min-h-9">
                <Save className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Save</span>
              </Button>
            </>
          ) : (
            <>
              {projectRole === "owner" && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => updateMutation.mutate({ priority: project.priority > 0 ? 0 : 1 } as Partial<Project>)}
                  className="min-h-11 min-w-11 md:min-h-9 md:min-w-9"
                >
                  <Star
                    className={`h-4 w-4 ${
                      project.priority > 0 ? "fill-yellow-400 text-yellow-400" : ""
                    }`}
                  />
                </Button>
              )}
              {(projectRole === "owner" || projectRole === "editor") && (
                <Button variant="outline" size="icon" onClick={startEditing} className="min-h-11 min-w-11 md:min-h-9 md:min-w-9">
                  <Edit2 className="h-4 w-4" />
                </Button>
              )}
              {projectRole === "owner" && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon" className="min-h-11 min-w-11 md:min-h-9 md:min-w-9">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => updateMutation.mutate({ status: "archived" })}
                    >
                      Archive
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={async () => {
                        const ok = await confirm({ title: "Delete this project?", description: "Notes and tasks will be unlinked. This cannot be undone.", destructive: true, confirmLabel: "Delete" });
                        if (ok) deleteMutation.mutate();
                      }}
                      className="text-destructive"
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </>
          )}
        </div>
      </div>

      {/* Project Health */}
      <ProjectHealthCard projectId={project.id} />

      {/* Stats Overview */}
      {stats && (
        <CollapsibleSection
          title="Overview"
          icon={<BarChart className="h-5 w-5" />}
          defaultExpanded={true}
          projectId={project.id}
          sectionKey="overview"
        >
          <StatsGrid
            stats={stats}
            onStatClick={(section) => {
              const element = document.getElementById(`section-${section}`);
              element?.scrollIntoView({ behavior: 'smooth' });
            }}
          />
        </CollapsibleSection>
      )}

      {/* Sub-projects */}
      {subProjects.length > 0 && (
        <CollapsibleSection
          title="Sub-projects"
          icon={<FolderOpen className="h-5 w-5" />}
          count={subProjects.length}
          defaultExpanded={true}
          projectId={project.id}
          sectionKey="subprojects"
        >
          <ProjectTree projects={subProjects} />
        </CollapsibleSection>
      )}

      {/* Activity Timeline */}
      <div ref={activityRef}>
        <CollapsibleSection
          title="Activity"
          icon={<Activity className="h-5 w-5" />}
          count={activities.length}
          defaultExpanded={false}
          projectId={project.id}
          sectionKey="activity"
        >
          {activityInView ? (
            <ActivityTimeline activities={activities} />
          ) : (
            <div className="space-y-2 py-2">
              <Skeleton className="h-10 rounded-lg" />
              <Skeleton className="h-10 rounded-lg" />
            </div>
          )}
        </CollapsibleSection>
      </div>

      {/* Content - RESPONSIVE: Single column on mobile */}
      <div className="grid gap-4 md:gap-6 md:grid-cols-2">
        {/* Notes */}
        <div id="section-notes">
          <CollapsibleSection
            title="Notes"
            icon={<FileText className="h-5 w-5" />}
            count={notes.length}
            defaultExpanded={true}
            projectId={project.id}
            sectionKey="notes"
          >
            {projectRole !== "viewer" && (
              <div className="flex justify-end mb-3">
                <Button size="sm" asChild className="min-h-9">
                  <Link href={`/notes/new?projectId=${project.id}`}>
                    <Plus className="h-4 w-4 mr-1" />
                    Add
                  </Link>
                </Button>
              </div>
            )}
            {notes.length === 0 ? (
              <div className="flex flex-col items-center text-center py-6">
                <FileText className="h-8 w-8 text-muted-foreground/40 mb-2" />
                <p className="text-sm text-muted-foreground mb-3">No notes in this project yet</p>
                {projectRole !== "viewer" && (
                  <Button size="sm" variant="outline" asChild className="min-h-9">
                    <Link href={`/notes/new?projectId=${project.id}`}>
                      <Plus className="h-4 w-4 mr-1" />
                      Create a note
                    </Link>
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {notes.map((note) => (
                  <Link
                    key={note.id}
                    href={`/notes/${note.slug}`}
                    className="block p-3 rounded-lg border hover:bg-muted/50 transition-colors min-h-14"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-sm md:text-base truncate">{note.title}</span>
                      {note.is_pinned && (
                        <Badge variant="secondary" className="text-xs shrink-0">
                          Pinned
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                      <span>{note.word_count} words</span>
                      <span>·</span>
                      <span>{format(new Date(note.updated_at), "MMM d")}</span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CollapsibleSection>
        </div>

        {/* Tasks */}
        <div id="section-tasks">
          <CollapsibleSection
            title="Tasks"
            icon={<CheckSquare className="h-5 w-5" />}
            count={tasks.filter((t) => t.status !== "completed").length}
            defaultExpanded={true}
            projectId={project.id}
            sectionKey="tasks"
          >
            {projectRole !== "viewer" && (
              <div className="flex justify-end mb-3">
                <Button size="sm" asChild className="min-h-9">
                  <Link href={`/tasks?projectId=${project.id}`}>
                    <Plus className="h-4 w-4 mr-1" />
                    Add
                  </Link>
                </Button>
              </div>
            )}
            {tasks.length === 0 ? (
              <div className="flex flex-col items-center text-center py-6">
                <CheckSquare className="h-8 w-8 text-muted-foreground/40 mb-2" />
                <p className="text-sm text-muted-foreground mb-3">No tasks in this project yet</p>
                {projectRole !== "viewer" && (
                  <Button size="sm" variant="outline" asChild className="min-h-9">
                    <Link href={`/tasks?projectId=${project.id}`}>
                      <Plus className="h-4 w-4 mr-1" />
                      Add a task
                    </Link>
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {tasks.map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center gap-3 p-3 rounded-lg border min-h-14"
                  >
                    {/* TOUCH: Larger checkbox on mobile */}
                    <button
                      onClick={() =>
                        toggleTaskMutation.mutate({
                          id: task.id,
                          status: task.status === "completed" ? "todo" : "completed",
                        })
                      }
                      className={`w-6 h-6 md:w-5 md:h-5 rounded border-2 flex items-center justify-center transition-colors shrink-0 ${
                        task.status === "completed"
                          ? "bg-green-500 border-green-500 text-white"
                          : "border-gray-300 hover:border-gray-400"
                      }`}
                    >
                      {task.status === "completed" && (
                        <CheckSquare className="h-3 w-3" />
                      )}
                    </button>
                    <span
                      className={`flex-1 text-sm md:text-base ${
                        task.status === "completed"
                          ? "text-muted-foreground line-through"
                          : ""
                      }`}
                    >
                      {task.content}
                    </span>
                    {/* MOBILE: Hide status badge on very small screens */}
                    <Badge
                      variant="secondary"
                      className={`${TASK_STATUS_COLORS[task.status]} hidden sm:inline-flex text-xs`}
                    >
                      {task.status.replace("_", " ")}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CollapsibleSection>
        </div>
      </div>

      {/* Captures Section */}
      <div ref={capturesRef} id="section-captures">
        <CollapsibleSection
          title="Captures"
          icon={<Package className="h-5 w-5" />}
          count={captures.length}
          defaultExpanded={false}
          projectId={project.id}
          sectionKey="captures"
        >
          {capturesInView ? (
            <CapturesCard captures={captures} />
          ) : (
            <div className="space-y-2 py-2">
              <Skeleton className="h-10 rounded-lg" />
              <Skeleton className="h-10 rounded-lg" />
            </div>
          )}
        </CollapsibleSection>
      </div>

      {/* Agent Tasks Section */}
      <div ref={agentTasksRef} id="section-agent-tasks">
        <CollapsibleSection
          title="AI Tasks"
          icon={<Bot className="h-5 w-5" />}
          count={agentTasks.length}
          defaultExpanded={false}
          projectId={project.id}
          sectionKey="agent-tasks"
        >
          {agentTasksInView ? (
            <AgentTasksCard agentTasks={agentTasks} />
          ) : (
            <div className="space-y-2 py-2">
              <Skeleton className="h-10 rounded-lg" />
              <Skeleton className="h-10 rounded-lg" />
            </div>
          )}
        </CollapsibleSection>
      </div>

      {/* Insights Section */}
      <div ref={insightsRef}>
        <CollapsibleSection
          title="AI Insights"
          icon={<Lightbulb className="h-5 w-5" />}
          count={insights.length}
          defaultExpanded={false}
          projectId={project.id}
          sectionKey="insights"
        >
          {insightsInView ? (
            <InsightsCard insights={insights} />
          ) : (
            <div className="space-y-2 py-2">
              <Skeleton className="h-10 rounded-lg" />
              <Skeleton className="h-10 rounded-lg" />
            </div>
          )}
        </CollapsibleSection>
      </div>

      {/* Task Recommendations Section */}
      <div ref={recommendationsRef}>
        <CollapsibleSection
          title="Task Recommendations"
          icon={<Target className="h-5 w-5" />}
          count={recommendations.length}
          defaultExpanded={false}
          projectId={project.id}
          sectionKey="recommendations"
        >
          {recommendationsInView ? (
            <TaskRecommendationsCard recommendations={recommendations} />
          ) : (
            <div className="space-y-2 py-2">
              <Skeleton className="h-10 rounded-lg" />
              <Skeleton className="h-10 rounded-lg" />
            </div>
          )}
        </CollapsibleSection>
      </div>

      {/* Note Connections Section */}
      <div ref={connectionsRef}>
        <CollapsibleSection
          title="Note Connections"
          icon={<Network className="h-5 w-5" />}
          count={connections.length}
          defaultExpanded={false}
          projectId={project.id}
          sectionKey="connections"
        >
          {connectionsInView ? (
            <NoteConnectionsCard connections={connections} />
          ) : (
            <div className="space-y-2 py-2">
              <Skeleton className="h-10 rounded-lg" />
              <Skeleton className="h-10 rounded-lg" />
            </div>
          )}
        </CollapsibleSection>
      </div>

      {/* Collaborators Section (owner only) */}
      {projectRole === "owner" && (
        <CollapsibleSection
          title="Collaborators"
          icon={<Users className="h-5 w-5" />}
          defaultExpanded={false}
          projectId={project.id}
          sectionKey="collaborators"
        >
          <CollaboratorsCard projectId={project.id} />
        </CollapsibleSection>
      )}
    </div>
  );
}
