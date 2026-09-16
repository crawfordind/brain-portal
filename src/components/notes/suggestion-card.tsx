// src/components/notes/suggestion-card.tsx
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import type { CleanupSuggestion } from "@/lib/cleanup/types";

interface SuggestionCardProps {
  suggestion: CleanupSuggestion;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

export function SuggestionCard({
  suggestion,
  checked,
  onCheckedChange,
}: SuggestionCardProps) {
  const getTypeColor = (type: string) => {
    switch (type) {
      case "structure":
        return "bg-blue-500/10 text-blue-700 dark:text-blue-300";
      case "duplicate":
        return "bg-amber-500/10 text-amber-700 dark:text-amber-300";
      case "task":
        return "bg-green-500/10 text-green-700 dark:text-green-300";
      case "tag":
        return "bg-purple-500/10 text-purple-700 dark:text-purple-300";
      default:
        return "bg-gray-500/10 text-gray-700 dark:text-gray-300";
    }
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.9) return "text-green-600 dark:text-green-400";
    if (confidence >= 0.8) return "text-blue-600 dark:text-blue-400";
    return "text-amber-600 dark:text-amber-400";
  };

  return (
    <Card className={checked ? "ring-2 ring-primary" : ""}>
      <CardContent className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-start gap-3">
          <Checkbox
            checked={checked}
            onCheckedChange={onCheckedChange}
            className="mt-1"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <Badge variant="secondary" className={getTypeColor(suggestion.type)}>
                {suggestion.type}
              </Badge>
              <Badge variant="outline" className={getConfidenceColor(suggestion.confidence)}>
                {Math.round(suggestion.confidence * 100)}% confident
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Target: <code className="text-xs bg-muted px-1 py-0.5 rounded">{suggestion.target}</code>
            </p>
          </div>
        </div>

        {/* Reasoning */}
        <p className="text-sm">{suggestion.reasoning}</p>

        {/* Diff view */}
        {suggestion.before && suggestion.after && (
          <div className="space-y-2 text-sm">
            <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded p-2">
              <div className="text-xs text-red-600 dark:text-red-400 font-semibold mb-1">
                Before:
              </div>
              <pre className="text-xs whitespace-pre-wrap break-words">{suggestion.before}</pre>
            </div>
            <div className="bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded p-2">
              <div className="text-xs text-green-600 dark:text-green-400 font-semibold mb-1">
                After:
              </div>
              <pre className="text-xs whitespace-pre-wrap break-words">{suggestion.after}</pre>
            </div>
          </div>
        )}

        {/* Content (for tasks/tags) */}
        {suggestion.content && (
          <div className="bg-muted rounded p-2">
            <div className="text-xs font-semibold mb-1">Content:</div>
            <pre className="text-xs whitespace-pre-wrap break-words">{suggestion.content}</pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
