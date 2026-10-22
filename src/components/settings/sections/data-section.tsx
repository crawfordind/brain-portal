"use client";

import { useState } from "react";
import { Download, FileArchive, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { VaultExportDialog } from "@/components/export/vault-export-dialog";
import { SettingsGroup, SettingsRow } from "../settings-primitives";

async function downloadJsonExport() {
  const [notesRes, projectsRes, tasksRes, capturesRes] = await Promise.all([
    fetch("/api/notes"),
    fetch("/api/projects"),
    fetch("/api/tasks?includeCompleted=true"),
    fetch("/api/captures"),
  ]);

  const [notes, projects, tasks, captures] = await Promise.all([
    notesRes.json(),
    projectsRes.json(),
    tasksRes.json(),
    capturesRes.json(),
  ]);

  const exportData = {
    exportedAt: new Date().toISOString(),
    notes: notes.notes,
    projects: projects.projects,
    tasks: tasks.tasks,
    captures: captures.captures,
  };

  const blob = new Blob([JSON.stringify(exportData, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `brain-portal-export-${new Date().toISOString().split("T")[0]}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function DataSection() {
  const [isExporting, setIsExporting] = useState(false);
  const [showVaultDialog, setShowVaultDialog] = useState(false);

  const handleJsonExport = async () => {
    setIsExporting(true);
    try {
      await downloadJsonExport();
      toast.success("Export downloaded");
    } catch {
      toast.error("Export failed. Try again.");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <SettingsGroup title="Export">
        <SettingsRow
          label="Export vault"
          description="Your notes as markdown files. Opens in Obsidian, Logseq and other markdown apps."
          stackOnMobile
        >
          <Button
            onClick={() => setShowVaultDialog(true)}
            className="min-h-11 w-full sm:min-h-9 sm:w-auto"
          >
            <FileArchive className="mr-2 h-4 w-4" />
            Export vault
          </Button>
        </SettingsRow>
        <SettingsRow
          label="Export raw data"
          description="Notes, projects, tasks and captures as one JSON file, for backup or migration."
          stackOnMobile
        >
          <Button
            variant="outline"
            onClick={handleJsonExport}
            disabled={isExporting}
            className="min-h-11 w-full sm:min-h-9 sm:w-auto"
          >
            <Download className="mr-2 h-4 w-4" />
            {isExporting ? "Exporting…" : "Export JSON"}
          </Button>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Danger zone" className="[&>div:last-child]:border-destructive/40">
        <SettingsRow
          label="Delete all data"
          description="Not available yet. Export a copy above if you want a backup."
          tone="danger"
          stackOnMobile
        >
          <Button
            variant="destructive"
            disabled
            className="min-h-11 w-full sm:min-h-9 sm:w-auto"
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete all
          </Button>
        </SettingsRow>
      </SettingsGroup>

      <VaultExportDialog open={showVaultDialog} onOpenChange={setShowVaultDialog} />
    </div>
  );
}
