"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  Settings,
  LogOut,
  Download,
  FileArchive,
  Trash2,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { themes } from "@/lib/themes";
import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { VoiceSettingsPanel } from "@/components/voice";
import { NotificationPreferencesPanel } from "@/components/notifications/notification-preferences";
import { GuardrailsSettingsPanel } from "@/components/settings/guardrails-settings";
import { ModelSettingsPanel } from "@/components/settings/model-settings";
import { McpKeysPanel } from "@/components/settings/mcp-keys-panel";
import { VaultExportDialog } from "@/components/export/vault-export-dialog";
export default function SettingsPage() {
  const router = useRouter();
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [isExporting, setIsExporting] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/auth/login");
      toast.success("Logged out");
    } catch {
      toast.error("Failed to logout");
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      // Fetch all user data
      const [notesRes, projectsRes, tasksRes, capturesRes] = await Promise.all([
        fetch("/api/notes"),
        fetch("/api/projects"),
        fetch("/api/tasks?includeCompleted=true"),
        fetch("/api/captures"),
      ]);

      const notes = await notesRes.json();
      const projects = await projectsRes.json();
      const tasks = await tasksRes.json();
      const captures = await capturesRes.json();

      const exportData = {
        exportedAt: new Date().toISOString(),
        notes: notes.notes,
        projects: projects.projects,
        tasks: tasks.tasks,
        captures: captures.captures,
      };

      // Download as JSON
      const blob = new Blob([JSON.stringify(exportData, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `dc-export-${new Date().toISOString().split("T")[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success("Data exported successfully");
    } catch {
      toast.error("Failed to export data");
    } finally {
      setIsExporting(false);
    }
  };

  const handleOpenExportDialog = useCallback(() => {
    setShowExportDialog(true);
  }, []);

  return (
    <div className="space-y-4 md:space-y-6 max-w-2xl">
      <div>
        {/* RESPONSIVE: Smaller title on mobile */}
        <h1 className="text-xl font-bold flex items-center gap-2 md:text-2xl">
          <Settings className="h-5 w-5 md:h-6 md:w-6" />
          Settings
        </h1>
        <p className="text-sm text-muted-foreground md:text-base">
          Manage your preferences and account
        </p>
      </div>

      {/* Appearance */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base md:text-lg">Appearance</CardTitle>
          <CardDescription className="text-xs md:text-sm">
            Customize how Brain Portal looks
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <div className="space-y-0.5">
              <Label className="text-sm md:text-base">Theme</Label>
              <p className="text-xs md:text-sm text-muted-foreground">
                Choose your preferred color scheme
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {themes.map((t) => {
                const isActive = resolvedTheme === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setTheme(t.id)}
                    className={cn(
                      "relative rounded-xl border-2 p-3 text-left transition-all hover:scale-[1.02] active:scale-[0.98]",
                      isActive
                        ? "border-primary ring-2 ring-primary/20"
                        : "border-border hover:border-primary/40"
                    )}
                    aria-label={`Select ${t.label} theme`}
                    aria-pressed={isActive}
                  >
                    {/* Mini theme preview */}
                    <div
                      className="mb-2.5 h-14 rounded-lg overflow-hidden flex shadow-sm"
                      style={{ background: t.preview.bg }}
                    >
                      {/* Sidebar strip */}
                      <div
                        className="w-8 h-full flex-shrink-0"
                        style={{ background: t.preview.surface }}
                      />
                      {/* Content lines */}
                      <div className="flex-1 p-1.5 flex flex-col gap-1.5 justify-center">
                        <div
                          className="h-1.5 rounded-full"
                          style={{
                            background: t.preview.text,
                            opacity: 0.5,
                            width: "70%",
                          }}
                        />
                        <div
                          className="h-1.5 rounded-full"
                          style={{
                            background: t.preview.text,
                            opacity: 0.3,
                            width: "45%",
                          }}
                        />
                        <div
                          className="h-2.5 rounded mt-1"
                          style={{
                            background: t.preview.accent,
                            width: "40%",
                          }}
                        />
                      </div>
                    </div>
                    <p className="text-xs font-semibold">{t.label}</p>
                    <p className="text-[10px] text-muted-foreground leading-tight">
                      {t.description}
                    </p>
                    {/* Active checkmark */}
                    {isActive && (
                      <div className="absolute top-2 right-2 h-5 w-5 rounded-full bg-primary flex items-center justify-center">
                        <Check className="h-3 w-3 text-primary-foreground" strokeWidth={3} />
                      </div>
                    )}
                  </button>
                );
              })}
              {/* System option */}
              <button
                onClick={() => setTheme("system")}
                className={cn(
                  "relative rounded-xl border-2 p-3 text-left transition-all hover:scale-[1.02] active:scale-[0.98]",
                  theme === "system"
                    ? "border-primary ring-2 ring-primary/20"
                    : "border-border hover:border-primary/40"
                )}
                aria-label="Use system theme"
                aria-pressed={theme === "system"}
              >
                {/* Half-and-half preview */}
                <div className="mb-2.5 h-14 rounded-lg overflow-hidden flex shadow-sm">
                  <div className="w-1/2 h-full bg-white" />
                  <div className="w-1/2 h-full bg-[#1c1c1e]" />
                </div>
                <p className="text-xs font-semibold">System</p>
                <p className="text-[10px] text-muted-foreground leading-tight">
                  Follows OS
                </p>
                {theme === "system" && (
                  <div className="absolute top-2 right-2 h-5 w-5 rounded-full bg-primary flex items-center justify-center">
                    <Check className="h-3 w-3 text-primary-foreground" strokeWidth={3} />
                  </div>
                )}
              </button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Editor */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base md:text-lg">Editor</CardTitle>
          <CardDescription className="text-xs md:text-sm">
            Configure your writing experience
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* TOUCH: Adequate spacing for toggle accessibility */}
          <div className="flex items-center justify-between gap-4 min-h-12">
            <div className="space-y-0.5">
              <Label className="text-sm md:text-base">Auto-save</Label>
              <p className="text-xs md:text-sm text-muted-foreground">
                Automatically save notes while editing
              </p>
            </div>
            <Switch defaultChecked />
          </div>
          <div className="flex items-center justify-between gap-4 min-h-12">
            <div className="space-y-0.5">
              <Label className="text-sm md:text-base">Spell check</Label>
              <p className="text-xs md:text-sm text-muted-foreground">
                Enable browser spell checking in editor
              </p>
            </div>
            <Switch defaultChecked />
          </div>
        </CardContent>
      </Card>

      {/* AI */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base md:text-lg">AI Features</CardTitle>
          <CardDescription className="text-xs md:text-sm">
            Configure AI-powered insights and suggestions
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4 min-h-12">
            <div className="space-y-0.5">
              <Label className="text-sm md:text-base">Auto-generate insights</Label>
              <p className="text-xs md:text-sm text-muted-foreground">
                Automatically generate insights from daily notes
              </p>
            </div>
            <Switch />
          </div>
          <div className="flex items-center justify-between gap-4 min-h-12">
            <div className="space-y-0.5">
              <Label className="text-sm md:text-base">Weekly review reminders</Label>
              <p className="text-xs md:text-sm text-muted-foreground">
                Remind to generate weekly review on Sundays
              </p>
            </div>
            <Switch defaultChecked />
          </div>
        </CardContent>
      </Card>

      {/* AI Models */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base md:text-lg">AI Models</CardTitle>
          <CardDescription className="text-xs md:text-sm">
            Choose which model handles each kind of work. The list comes live
            from OpenRouter, so retired models disappear on their own — and if a
            choice stops working, requests fall back automatically rather than
            failing.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ModelSettingsPanel />
        </CardContent>
      </Card>

      {/* AI Guardrails */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base md:text-lg">AI Guardrails</CardTitle>
          <CardDescription className="text-xs md:text-sm">
            Define who you are, what you believe, and how AI should respond to you.
            This profile is sent with every AI request.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <GuardrailsSettingsPanel />
        </CardContent>
      </Card>

      {/* MCP API Keys */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base md:text-lg">AI API access</CardTitle>
          <CardDescription className="text-xs md:text-sm">
            Generate and manage API keys for external AI agents and MCP
            clients.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <McpKeysPanel />
        </CardContent>
      </Card>

      {/* Notifications */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base md:text-lg">Notifications</CardTitle>
          <CardDescription className="text-xs md:text-sm">
            Configure reminders, email alerts, AI digests, and weekly reports
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NotificationPreferencesPanel />
        </CardContent>
      </Card>

      {/* Voice Input */}
      <VoiceSettingsPanel />

      {/* Data */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base md:text-lg">Data</CardTitle>
          <CardDescription className="text-xs md:text-sm">
            Export or manage your data
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Vault Export - Primary action */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-0.5">
              <Label className="text-sm md:text-base">Export Vault</Label>
              <p className="text-xs md:text-sm text-muted-foreground">
                Download your vault as markdown — compatible with Obsidian, Logseq, and more
              </p>
            </div>
            <Button
              onClick={handleOpenExportDialog}
              className="w-full sm:w-auto min-h-11 md:min-h-9"
            >
              <FileArchive className="h-4 w-4 mr-2" />
              Export Vault
            </Button>
          </div>
          {/* JSON Export - Secondary action */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-0.5">
              <Label className="text-sm md:text-base">Export raw data</Label>
              <p className="text-xs md:text-sm text-muted-foreground">
                Download all data as JSON for backup or migration
              </p>
            </div>
            <Button
              variant="outline"
              onClick={handleExport}
              disabled={isExporting}
              className="w-full sm:w-auto min-h-11 md:min-h-9"
            >
              <Download className="h-4 w-4 mr-2" />
              {isExporting ? "Exporting..." : "Export JSON"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Vault Export Dialog */}
      <VaultExportDialog open={showExportDialog} onOpenChange={setShowExportDialog} />

      {/* Account */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base md:text-lg">Account</CardTitle>
          <CardDescription className="text-xs md:text-sm">
            Manage your account settings
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-0.5">
              <Label className="text-sm md:text-base">Sign out</Label>
              <p className="text-xs md:text-sm text-muted-foreground">
                Sign out of your account on this device
              </p>
            </div>
            <Button variant="outline" onClick={handleLogout} className="w-full sm:w-auto min-h-11 md:min-h-9">
              <LogOut className="h-4 w-4 mr-2" />
              Sign Out
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Danger Zone */}
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-destructive text-base md:text-lg">Danger Zone</CardTitle>
          <CardDescription className="text-xs md:text-sm">
            Irreversible actions - proceed with caution
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-0.5">
              <Label className="text-sm md:text-base text-muted-foreground">Delete all data</Label>
              <p className="text-xs md:text-sm text-muted-foreground">
                Not yet available. Use JSON export above to back up your data.
              </p>
            </div>
            <Button
              variant="destructive"
              disabled
              title="Data deletion is not yet available"
              className="w-full sm:w-auto min-h-11 md:min-h-9"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete All
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
