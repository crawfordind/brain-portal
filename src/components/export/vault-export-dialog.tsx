"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  FileArchive,
  Download,
  FolderOpen,
  FileText,
  ListTodo,
  BookOpen,
  Bell,
  Lightbulb,
  Link2,
  Inbox,
  FolderTree,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import type { ExportFormat } from "@/lib/export/markdown-export";

interface ExportCounts {
  notes: number;
  captures: number;
  tasks: number;
  journal: number;
  reminders: number;
  insights: number;
  connections: number;
  projects: number;
}

interface ContentToggle {
  key: keyof SelectionState;
  label: string;
  description: string;
  icon: React.ReactNode;
}

interface SelectionState {
  notes: boolean;
  captures: boolean;
  tasks: boolean;
  journal: boolean;
  reminders: boolean;
  insights: boolean;
  connections: boolean;
}

const CONTENT_TYPES: ContentToggle[] = [
  {
    key: "notes",
    label: "Notes",
    description: "All notes, daily notes, and weekly reviews",
    icon: <FileText className="h-4 w-4" />,
  },
  {
    key: "captures",
    label: "Captures",
    description: "Quick thoughts, ideas, and references",
    icon: <Inbox className="h-4 w-4" />,
  },
  {
    key: "tasks",
    label: "Tasks",
    description: "All tasks organized by project",
    icon: <ListTodo className="h-4 w-4" />,
  },
  {
    key: "journal",
    label: "Journal",
    description: "Journal entries organized by month",
    icon: <BookOpen className="h-4 w-4" />,
  },
  {
    key: "reminders",
    label: "Reminders",
    description: "All reminders with status and scheduling",
    icon: <Bell className="h-4 w-4" />,
  },
  {
    key: "insights",
    label: "AI Insights",
    description: "AI-generated patterns and connections",
    icon: <Lightbulb className="h-4 w-4" />,
  },
];

type ExportPhase = "idle" | "preparing" | "downloading" | "done";

export function VaultExportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [counts, setCounts] = useState<ExportCounts | null>(null);
  const [loadingCounts, setLoadingCounts] = useState(false);
  const [format, setFormat] = useState<ExportFormat>("obsidian");
  const [selected, setSelected] = useState({
    notes: true,
    captures: true,
    tasks: true,
    journal: true,
    reminders: true,
    insights: true,
    connections: true,
  });
  const [phase, setPhase] = useState<ExportPhase>("idle");

  // Fetch counts when dialog opens
  useEffect(() => {
    if (!open) {
      setPhase("idle");
      return;
    }
    setLoadingCounts(true);
    fetch("/api/export/preview")
      .then((res) => res.json())
      .then((data) => setCounts(data.counts))
      .catch(() => toast.error("Failed to load export preview"))
      .finally(() => setLoadingCounts(false));
  }, [open]);

  const toggleContent = useCallback((key: string, checked: boolean) => {
    setSelected((prev: SelectionState) => ({ ...prev, [key]: checked }));
  }, []);

  const selectAll = useCallback(() => {
    setSelected({
      notes: true,
      captures: true,
      tasks: true,
      journal: true,
      reminders: true,
      insights: true,
      connections: true,
    });
  }, []);

  const deselectAll = useCallback(() => {
    setSelected({
      notes: false,
      captures: false,
      tasks: false,
      journal: false,
      reminders: false,
      insights: false,
      connections: false,
    });
  }, []);

  // Compute selected file count estimate
  const selectedCount = counts
    ? (selected.notes ? counts.notes : 0) +
      (selected.captures ? counts.captures : 0) +
      (selected.tasks ? counts.tasks : 0) +
      (selected.journal ? counts.journal : 0) +
      (selected.reminders ? counts.reminders : 0) +
      (selected.insights ? counts.insights : 0) +
      1 // README
    : 0;

  const hasSelection = Object.values(selected).some(Boolean);

  const handleExport = useCallback(async () => {
    setPhase("preparing");

    try {
      const params = new URLSearchParams();
      params.set("format", format);
      if (!selected.notes) params.set("notes", "false");
      if (!selected.captures) params.set("captures", "false");
      if (!selected.tasks) params.set("tasks", "false");
      if (!selected.journal) params.set("journal", "false");
      if (!selected.reminders) params.set("reminders", "false");
      if (!selected.insights) params.set("insights", "false");
      if (!selected.connections) params.set("connections", "false");

      setPhase("downloading");
      const res = await fetch(`/api/export/markdown?${params.toString()}`);
      if (!res.ok) throw new Error("Export failed");

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const dateStr = new Date().toISOString().split("T")[0];
      const formatLabel = format === "obsidian" ? "obsidian" : "markdown";
      a.download = `vault-${formatLabel}-${dateStr}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setPhase("done");
      toast.success("Vault exported successfully");
    } catch {
      setPhase("idle");
      toast.error("Failed to export vault");
    }
  }, [format, selected]);

  const isExporting = phase === "preparing" || phase === "downloading";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="standard" dismissible={!isExporting} showCloseButton={!isExporting}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileArchive className="h-5 w-5" />
            Export Vault
          </DialogTitle>
          <DialogDescription>
            Download your entire vault as markdown files. Compatible with Obsidian, Logseq, and any markdown editor.
          </DialogDescription>
        </DialogHeader>

        {phase === "done" ? (
          <div className="flex flex-col items-center justify-center py-8 gap-4">
            <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center">
              <CheckCircle2 className="h-7 w-7 text-primary" />
            </div>
            <div className="text-center space-y-1">
              <p className="font-semibold text-lg">Export Complete</p>
              <p className="text-sm text-muted-foreground">
                {selectedCount.toLocaleString()} files exported as {format === "obsidian" ? "an Obsidian vault" : "standard markdown"}
              </p>
            </div>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </div>
        ) : (
          <>
            {/* Format Selection */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">Format</Label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setFormat("obsidian")}
                  disabled={isExporting}
                  className={`relative rounded-lg border-2 p-3 text-left transition-all ${
                    format === "obsidian"
                      ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                      : "border-border hover:border-primary/40"
                  } ${isExporting ? "opacity-60 cursor-not-allowed" : ""}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <FolderOpen className="h-4 w-4 text-purple-500" />
                    <span className="text-sm font-medium">Obsidian</span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-snug">
                    [[Wikilinks]], YAML frontmatter, folder structure
                  </p>
                </button>
                <button
                  onClick={() => setFormat("standard")}
                  disabled={isExporting}
                  className={`relative rounded-lg border-2 p-3 text-left transition-all ${
                    format === "standard"
                      ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                      : "border-border hover:border-primary/40"
                  } ${isExporting ? "opacity-60 cursor-not-allowed" : ""}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <FileText className="h-4 w-4 text-blue-500" />
                    <span className="text-sm font-medium">Standard</span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-snug">
                    Regular markdown links, universal compatibility
                  </p>
                </button>
              </div>
            </div>

            <Separator />

            {/* Content Selection */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Content</Label>
                <div className="flex gap-2">
                  <button
                    onClick={selectAll}
                    disabled={isExporting}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                  >
                    Select all
                  </button>
                  <span className="text-xs text-muted-foreground">·</span>
                  <button
                    onClick={deselectAll}
                    disabled={isExporting}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                  >
                    Deselect all
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                {CONTENT_TYPES.map((type) => {
                  const count = counts?.[type.key] ?? 0;
                  const isChecked = selected[type.key];

                  return (
                    <label
                      key={type.key}
                      className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors ${
                        isChecked
                          ? "border-primary/30 bg-primary/5"
                          : "border-transparent hover:bg-muted/50"
                      } ${isExporting ? "opacity-60 pointer-events-none" : ""}`}
                    >
                      <Checkbox
                        checked={isChecked}
                        onCheckedChange={(checked: boolean | "indeterminate") =>
                          toggleContent(type.key, checked === true)
                        }
                        disabled={isExporting}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {type.icon}
                          <span className="text-sm font-medium">{type.label}</span>
                          {loadingCounts ? (
                            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                          ) : (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 font-normal">
                              {count.toLocaleString()}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {type.description}
                        </p>
                      </div>
                    </label>
                  );
                })}

                {/* Connections toggle - shown only when notes are selected */}
                {selected.notes && (
                  <label
                    className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 ml-6 cursor-pointer transition-colors ${
                      selected.connections
                        ? "border-primary/30 bg-primary/5"
                        : "border-transparent hover:bg-muted/50"
                    } ${isExporting ? "opacity-60 pointer-events-none" : ""}`}
                  >
                    <Checkbox
                      checked={selected.connections}
                      onCheckedChange={(checked: boolean | "indeterminate") =>
                        toggleContent("connections", checked === true)
                      }
                      disabled={isExporting}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Link2 className="h-4 w-4" />
                        <span className="text-sm font-medium">Note Connections</span>
                        {loadingCounts ? (
                          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                        ) : (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 font-normal">
                            {(counts?.connections ?? 0).toLocaleString()}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Append connected notes section to each note
                      </p>
                    </div>
                  </label>
                )}
              </div>
            </div>

            <Separator />

            {/* Vault Preview */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Vault Structure Preview</Label>
              <div className="rounded-lg border bg-muted/30 p-3 font-mono text-xs text-muted-foreground space-y-0.5 max-h-40 overflow-y-auto">
                <div className="flex items-center gap-1.5">
                  <FolderTree className="h-3.5 w-3.5 flex-shrink-0" />
                  <span className="text-foreground font-medium">vault/</span>
                </div>
                {selected.notes && (
                  <>
                    <div className="pl-5">
                      <span>daily/</span>
                      <span className="text-muted-foreground/60"> — daily notes</span>
                    </div>
                    <div className="pl-5">
                      <span>weekly/</span>
                      <span className="text-muted-foreground/60"> — weekly reviews</span>
                    </div>
                    <div className="pl-5">
                      <span>projects/</span>
                      <span className="text-muted-foreground/60"> — notes by project</span>
                    </div>
                    <div className="pl-5">
                      <span>uncategorized/</span>
                      <span className="text-muted-foreground/60"> — other notes</span>
                    </div>
                  </>
                )}
                {selected.captures && (
                  <div className="pl-5">
                    <span>captures/</span>
                    <span className="text-muted-foreground/60"> — quick captures</span>
                  </div>
                )}
                {selected.tasks && (
                  <div className="pl-5">
                    <span>tasks/</span>
                    <span className="text-muted-foreground/60"> — tasks by project</span>
                  </div>
                )}
                {selected.journal && (
                  <div className="pl-5">
                    <span>journal/</span>
                    <span className="text-muted-foreground/60"> — entries by month</span>
                  </div>
                )}
                {selected.reminders && (
                  <div className="pl-5">
                    <span>reminders/</span>
                    <span className="text-muted-foreground/60"> — all reminders</span>
                  </div>
                )}
                {selected.insights && (
                  <div className="pl-5">
                    <span>insights/</span>
                    <span className="text-muted-foreground/60"> — AI insights by type</span>
                  </div>
                )}
                <div className="pl-5">
                  <span>README.md</span>
                  <span className="text-muted-foreground/60"> — vault index</span>
                </div>
              </div>
            </div>

            {/* Footer */}
            <DialogFooter className="flex-col sm:flex-row gap-2 sm:gap-0">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mr-auto">
                <Download className="h-3.5 w-3.5" />
                {loadingCounts ? (
                  <span>Calculating...</span>
                ) : (
                  <span>~{selectedCount.toLocaleString()} files as ZIP</span>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={isExporting}
                  className="min-h-11 md:min-h-9"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleExport}
                  disabled={isExporting || !hasSelection || loadingCounts}
                  className="min-h-11 md:min-h-9 min-w-[140px]"
                >
                  {isExporting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      {phase === "preparing" ? "Preparing..." : "Downloading..."}
                    </>
                  ) : (
                    <>
                      <FileArchive className="h-4 w-4 mr-2" />
                      Export Vault
                    </>
                  )}
                </Button>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
