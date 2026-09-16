// src/components/notes/analysis-modal.tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Loader2,
  AlertCircle,
  Save,
  Copy,
  Check,
  Brain,
  Sparkles,
  Clock,
  FileText,
  Gauge,
} from "lucide-react";
import { toast } from "sonner";
import {
  ExecutiveSummaryCard,
  KeyFindingsCard,
  ResearchThreadsCard,
  ActionItemsCard,
  OpenQuestionsCard,
  LinksCard,
  EntitiesCard,
  RelatedNotesCard,
} from "./analysis-section-card";
import type { NoteAnalysisResult } from "@/lib/analysis/types";

interface AnalysisModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  noteId: string;
  noteTitle: string;
  onSaved?: (slug: string) => void;
}

type AnalysisTab = "overview" | "research" | "actions" | "extraction";

const COMPLEXITY_LABELS = {
  simple: { label: "Simple", color: "bg-green-500/10 text-green-700 dark:text-green-400" },
  moderate: { label: "Moderate", color: "bg-blue-500/10 text-blue-700 dark:text-blue-400" },
  complex: { label: "Complex", color: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  dense: { label: "Dense", color: "bg-red-500/10 text-red-700 dark:text-red-400" },
};

export function AnalysisModal({
  open,
  onOpenChange,
  noteId,
  noteTitle,
  onSaved,
}: AnalysisModalProps) {
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<NoteAnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AnalysisTab>("overview");
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saveTitle, setSaveTitle] = useState("");
  const [showSaveInput, setShowSaveInput] = useState(false);

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setResult(null);
      setError(null);
      setActiveTab("overview");
      setShowSaveInput(false);
      setSaveTitle("");
      analyzeNote();
    }
  }, [open]);

  const analyzeNote = async () => {
    setAnalyzing(true);
    setError(null);

    try {
      const response = await fetch(`/api/notes/${noteId}/analyze`, {
        method: "POST",
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Analysis failed");
      }

      const data: NoteAnalysisResult = await response.json();
      setResult(data);
      setSaveTitle(`Analysis: ${noteTitle}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Analysis failed";
      setError(message);
      toast.error(message);
    } finally {
      setAnalyzing(false);
    }
  };

  const formatAsMarkdown = useCallback((): string => {
    if (!result) return "";

    const sections: string[] = [];

    sections.push(`# Analysis: ${noteTitle}\n`);
    sections.push(`> Generated on ${new Date(result.analyzedAt).toLocaleDateString()} | ${result.wordCount} words | ${result.readTime} min read | Complexity: ${result.complexity}\n`);

    // Executive Summary
    if (result.executiveSummary) {
      sections.push(`## Executive Summary\n\n${result.executiveSummary}\n`);
    }

    // Topics
    if (result.topics.length > 0) {
      sections.push(`**Topics:** ${result.topics.join(", ")}\n`);
    }

    // Key Findings
    if (result.keyFindings.length > 0) {
      sections.push(`## Key Findings\n`);
      result.keyFindings.forEach((f, i) => {
        sections.push(`### ${i + 1}. ${f.insight} [${f.importance}]\n`);
        if (f.evidence) {
          sections.push(`> ${f.evidence}\n`);
        }
      });
    }

    // Research Threads
    if (result.researchThreads.length > 0) {
      sections.push(`## Research Threads\n`);
      result.researchThreads.forEach((t) => {
        sections.push(`### ${t.topic} [${t.depth}]\n\n${t.summary}\n`);
        if (t.relatedConcepts.length > 0) {
          sections.push(`**Related:** ${t.relatedConcepts.join(", ")}\n`);
        }
        if (t.suggestedQueries.length > 0) {
          sections.push(`**Search:** ${t.suggestedQueries.join(" | ")}\n`);
        }
      });
    }

    // Action Items
    if (result.actionItems.length > 0) {
      sections.push(`## Action Items\n`);
      result.actionItems.forEach((a) => {
        sections.push(`- [ ] **[${a.priority}]** ${a.action} _(${a.category.replace("_", " ")})_`);
        sections.push(`  - ${a.reasoning}`);
      });
      sections.push("");
    }

    // Open Questions
    if (result.openQuestions.length > 0) {
      sections.push(`## Open Questions\n`);
      result.openQuestions.forEach((q) => {
        sections.push(`- **${q.question}** _(${q.type})_`);
        sections.push(`  - ${q.context}`);
      });
      sections.push("");
    }

    // Entities
    if (result.entities.length > 0) {
      sections.push(`## Entities\n`);
      const byType: Record<string, typeof result.entities> = {};
      result.entities.forEach((e) => {
        if (!byType[e.type]) byType[e.type] = [];
        byType[e.type].push(e);
      });
      Object.entries(byType).forEach(([type, entities]) => {
        sections.push(`**${type}:** ${entities.map((e) => e.name).join(", ")}`);
      });
      sections.push("");
    }

    // Links
    if (result.links.length > 0) {
      sections.push(`## Links & References\n`);
      result.links.forEach((l) => {
        sections.push(`- [${l.title || l.url}](${l.url})`);
      });
      sections.push("");
    }

    // Related Notes
    if (result.relatedNoteIds.length > 0) {
      sections.push(`## Related Notes\n`);
      result.relatedNoteIds.forEach((n) => {
        sections.push(`- ${n.title} (${Math.round(n.similarity * 100)}% similar)`);
      });
      sections.push("");
    }

    // Metadata footer
    sections.push(`---`);
    sections.push(`*AI analysis of "${noteTitle}" | Generated ${new Date(result.analyzedAt).toLocaleString()}*`);

    return sections.join("\n");
  }, [result, noteTitle]);

  const copyAll = async () => {
    const markdown = formatAsMarkdown();
    await navigator.clipboard.writeText(markdown);
    setCopied(true);
    toast.success("Analysis copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  const saveAsNote = async () => {
    if (!result || !saveTitle.trim()) return;

    setSaving(true);
    try {
      const response = await fetch(`/api/notes/${noteId}/analyze`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: saveTitle.trim(),
          content: formatAsMarkdown(),
        }),
      });

      if (!response.ok) throw new Error("Failed to save");

      const data = await response.json();
      toast.success("Analysis saved as note");
      onSaved?.(data.slug);
      onOpenChange(false);
    } catch {
      toast.error("Failed to save analysis");
    } finally {
      setSaving(false);
    }
  };

  // Count items for tab badges
  const overviewCount = result
    ? (result.executiveSummary ? 1 : 0) + result.keyFindings.length + result.entities.length
    : 0;
  const researchCount = result
    ? result.researchThreads.length + result.openQuestions.length
    : 0;
  const actionsCount = result ? result.actionItems.length : 0;
  const extractionCount = result
    ? result.links.length + result.relatedNoteIds.length
    : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col p-0 gap-0">
        {/* Header */}
        <DialogHeader className="px-5 pt-5 pb-3 shrink-0">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
              <Brain className="h-4.5 w-4.5 text-white" />
            </div>
            <div>
              <DialogTitle className="text-base">Deep Analysis</DialogTitle>
              <DialogDescription className="text-xs">
                AI-powered analysis of your note
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Loading State */}
        {analyzing && (
          <div className="flex-1 flex flex-col items-center justify-center py-16 px-6">
            <div className="relative mb-6">
              <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-violet-500/20 to-indigo-600/20 flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-violet-500" />
              </div>
              <Sparkles className="h-4 w-4 text-amber-500 absolute -top-1 -right-1 animate-pulse" />
            </div>
            <p className="text-sm font-medium mb-1">Analyzing your note</p>
            <p className="text-xs text-muted-foreground text-center max-w-xs">
              Extracting entities, finding connections, generating insights...
            </p>
          </div>
        )}

        {/* Error State */}
        {error && !analyzing && (
          <div className="flex-1 flex flex-col items-center justify-center py-16 px-6">
            <div className="h-12 w-12 rounded-xl bg-destructive/10 flex items-center justify-center mb-4">
              <AlertCircle className="h-6 w-6 text-destructive" />
            </div>
            <p className="text-sm font-medium mb-1">Analysis failed</p>
            <p className="text-xs text-muted-foreground text-center max-w-xs mb-4">
              {error}
            </p>
            <Button variant="outline" size="sm" onClick={analyzeNote}>
              Try Again
            </Button>
          </div>
        )}

        {/* Results */}
        {result && !analyzing && (
          <>
            {/* Stats Bar */}
            <div className="flex items-center gap-3 px-5 pb-3 flex-wrap">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <FileText className="h-3 w-3" />
                <span>{result.wordCount} words</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                <span>{result.readTime} min read</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs">
                <Gauge className="h-3 w-3 text-muted-foreground" />
                <Badge
                  variant="secondary"
                  className={`text-[10px] px-1.5 py-0 ${COMPLEXITY_LABELS[result.complexity].color}`}
                >
                  {COMPLEXITY_LABELS[result.complexity].label}
                </Badge>
              </div>
              {result.topics.length > 0 && (
                <div className="flex items-center gap-1 flex-wrap ml-auto">
                  {result.topics.slice(0, 4).map((topic) => (
                    <Badge key={topic} variant="outline" className="text-[10px] px-1.5 py-0">
                      {topic}
                    </Badge>
                  ))}
                  {result.topics.length > 4 && (
                    <span className="text-[10px] text-muted-foreground">
                      +{result.topics.length - 4}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Tabs */}
            <Tabs
              value={activeTab}
              onValueChange={(v) => setActiveTab(v as AnalysisTab)}
              className="flex-1 flex flex-col min-h-0"
            >
              <TabsList className="grid grid-cols-4 mx-5 shrink-0">
                <TabsTrigger value="overview" className="text-xs">
                  Overview{overviewCount > 0 && ` (${overviewCount})`}
                </TabsTrigger>
                <TabsTrigger value="research" className="text-xs">
                  Research{researchCount > 0 && ` (${researchCount})`}
                </TabsTrigger>
                <TabsTrigger value="actions" className="text-xs">
                  Actions{actionsCount > 0 && ` (${actionsCount})`}
                </TabsTrigger>
                <TabsTrigger value="extraction" className="text-xs">
                  Extraction{extractionCount > 0 && ` (${extractionCount})`}
                </TabsTrigger>
              </TabsList>

              <div className="flex-1 overflow-y-auto px-5 py-4">
                <TabsContent value="overview" className="mt-0 space-y-3">
                  {result.executiveSummary && (
                    <ExecutiveSummaryCard summary={result.executiveSummary} />
                  )}
                  <KeyFindingsCard findings={result.keyFindings} />
                  <EntitiesCard entities={result.entities} />
                </TabsContent>

                <TabsContent value="research" className="mt-0 space-y-3">
                  <ResearchThreadsCard threads={result.researchThreads} />
                  <OpenQuestionsCard questions={result.openQuestions} />
                </TabsContent>

                <TabsContent value="actions" className="mt-0 space-y-3">
                  <ActionItemsCard items={result.actionItems} />
                </TabsContent>

                <TabsContent value="extraction" className="mt-0 space-y-3">
                  <LinksCard links={result.links} />
                  <RelatedNotesCard notes={result.relatedNoteIds} />
                </TabsContent>
              </div>
            </Tabs>

            {/* Footer Actions */}
            <div className="border-t px-5 py-3 shrink-0">
              {showSaveInput ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={saveTitle}
                    onChange={(e) => setSaveTitle(e.target.value)}
                    placeholder="Analysis note title..."
                    className="flex-1 h-9 text-sm"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveAsNote();
                      if (e.key === "Escape") setShowSaveInput(false);
                    }}
                  />
                  <Button size="sm" onClick={saveAsNote} disabled={saving || !saveTitle.trim()}>
                    {saving ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <>
                        <Save className="h-3.5 w-3.5 mr-1.5" />
                        Save
                      </>
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowSaveInput(false)}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2 justify-end">
                  <Button variant="outline" size="sm" onClick={copyAll}>
                    {copied ? (
                      <>
                        <Check className="h-3.5 w-3.5 mr-1.5 text-green-500" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5 mr-1.5" />
                        Copy All
                      </>
                    )}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => setShowSaveInput(true)}
                    className="bg-gradient-to-r from-violet-500 to-indigo-600 hover:from-violet-600 hover:to-indigo-700"
                  >
                    <Save className="h-3.5 w-3.5 mr-1.5" />
                    Save as Note
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
