// src/components/notes/cleanup-modal.tsx
"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { SuggestionCard } from "./suggestion-card";
import type { CleanupSuggestion, AnalysisResult } from "@/lib/cleanup/types";

interface CleanupModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  noteId: string;
  onApplied?: () => void;
}

export function CleanupModal({
  open,
  onOpenChange,
  noteId,
  onApplied,
}: CleanupModalProps) {
  const [analyzing, setAnalyzing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<string>("all");

  // Auto-analyze when modal opens
  useEffect(() => {
    if (open && !result && !analyzing) {
      analyzeNote();
    }
  }, [open]);

  const analyzeNote = async () => {
    setAnalyzing(true);
    setError(null);

    try {
      const response = await fetch(`/api/notes/${noteId}/cleanup`, {
        method: 'POST',
      });
      if (!response.ok) {
        throw new Error("Failed to analyze note");
      }

      const data = await response.json();
      setResult(data);

      // Auto-select high-confidence suggestions (>= 0.9)
      const highConfidence = new Set<string>(
        data.suggestions
          .filter((s: CleanupSuggestion) => s.confidence >= 0.9)
          .map((s: CleanupSuggestion) => s.id)
      );
      setSelectedIds(highConfidence);

      // Set initial tab based on available suggestions
      if (data.suggestions.length > 0) {
        const firstType = data.suggestions[0].type;
        setActiveTab(firstType);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
      toast.error("Failed to analyze note");
    } finally {
      setAnalyzing(false);
    }
  };

  const applySelected = async () => {
    if (selectedIds.size === 0) {
      toast.error("No suggestions selected");
      return;
    }

    setApplying(true);

    try {
      // Filter full suggestion objects for selected IDs
      const approvedSuggestions = result?.suggestions.filter(s => selectedIds.has(s.id)) || [];

      const response = await fetch(`/api/notes/${noteId}/cleanup`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          suggestions: approvedSuggestions,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to apply suggestions");
      }

      await response.json();
      toast.success(`Applied ${approvedSuggestions.length} suggestion(s)`);

      onOpenChange(false);
      onApplied?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to apply");
    } finally {
      setApplying(false);
    }
  };

  const toggleSuggestion = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectAll = () => {
    if (!result) return;
    const allIds = new Set(result.suggestions.map((s) => s.id));
    setSelectedIds(allIds);
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  const getSuggestionsByType = (type: string) => {
    if (!result) return [];
    return result.suggestions.filter((s) => s.type === type);
  };

  const renderTabContent = (type: string) => {
    const suggestions = getSuggestionsByType(type);

    if (suggestions.length === 0) {
      return (
        <div className="text-center py-8 text-muted-foreground">
          No {type} suggestions found
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {suggestions.map((suggestion) => (
          <SuggestionCard
            key={suggestion.id}
            suggestion={suggestion}
            checked={selectedIds.has(suggestion.id)}
            onCheckedChange={() => toggleSuggestion(suggestion.id)}
          />
        ))}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Cleanup Suggestions</DialogTitle>
          <DialogDescription>
            AI-powered suggestions to improve your note
          </DialogDescription>
        </DialogHeader>

        {/* Loading State */}
        {analyzing && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <span className="ml-3 text-muted-foreground">Analyzing note...</span>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="flex items-center gap-2 p-4 bg-destructive/10 border border-destructive rounded">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {/* Results */}
        {result && !analyzing && (
          <>
            {/* Summary */}
            <div className="flex items-center justify-between p-3 bg-muted rounded">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                <span className="text-sm font-medium">
                  {result.suggestions.length} suggestion(s) found
                </span>
                {result.chunked && (
                  <span className="text-xs text-muted-foreground">
                    (analyzed in {result.chunkCount} chunks)
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={selectAll}>
                  Select All
                </Button>
                <Button variant="ghost" size="sm" onClick={deselectAll}>
                  Deselect All
                </Button>
              </div>
            </div>

            {/* Tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid grid-cols-5 w-full">
                <TabsTrigger value="all">
                  All ({result.suggestions.length})
                </TabsTrigger>
                <TabsTrigger value="structure">
                  Structure ({getSuggestionsByType("structure").length})
                </TabsTrigger>
                <TabsTrigger value="duplicate">
                  Duplicates ({getSuggestionsByType("duplicate").length})
                </TabsTrigger>
                <TabsTrigger value="task">
                  Tasks ({getSuggestionsByType("task").length})
                </TabsTrigger>
                <TabsTrigger value="tag">
                  Tags ({getSuggestionsByType("tag").length})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="all" className="space-y-3 mt-4">
                {result.suggestions.map((suggestion) => (
                  <SuggestionCard
                    key={suggestion.id}
                    suggestion={suggestion}
                    checked={selectedIds.has(suggestion.id)}
                    onCheckedChange={() => toggleSuggestion(suggestion.id)}
                  />
                ))}
              </TabsContent>

              <TabsContent value="structure" className="mt-4">
                {renderTabContent("structure")}
              </TabsContent>

              <TabsContent value="duplicate" className="mt-4">
                {renderTabContent("duplicate")}
              </TabsContent>

              <TabsContent value="task" className="mt-4">
                {renderTabContent("task")}
              </TabsContent>

              <TabsContent value="tag" className="mt-4">
                {renderTabContent("tag")}
              </TabsContent>
            </Tabs>
          </>
        )}

        {/* Footer */}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={applySelected}
            disabled={applying || selectedIds.size === 0 || analyzing}
          >
            {applying ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Applying...
              </>
            ) : (
              `Apply ${selectedIds.size} Selected`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
