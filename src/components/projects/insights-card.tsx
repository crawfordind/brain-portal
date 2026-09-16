import { formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Lightbulb, Sparkles } from "lucide-react";
import { Insight } from "@/lib/db/schema";

interface InsightsCardProps {
  insights: Insight[];
}

const INSIGHT_TYPE_COLORS: Record<string, string> = {
  pattern: "bg-purple-500/10 text-purple-600",
  connection: "bg-blue-500/10 text-blue-600",
  suggestion: "bg-green-500/10 text-green-600",
  trend: "bg-orange-500/10 text-orange-600",
};

export function InsightsCard({ insights }: InsightsCardProps) {
  if (insights.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-4">
        No AI insights generated yet
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {insights.map((insight) => {
        const colorClass = INSIGHT_TYPE_COLORS[insight.insight_type] || INSIGHT_TYPE_COLORS.suggestion;

        return (
          <div
            key={insight.id}
            className="p-3 rounded-lg border hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-yellow-500 shrink-0" />
                <Badge variant="secondary" className={`${colorClass} text-xs`}>
                  {insight.insight_type}
                </Badge>
              </div>
              <span className="text-xs text-muted-foreground shrink-0">
                {formatDistanceToNow(new Date(insight.generated_at), { addSuffix: true })}
              </span>
            </div>
            <p className="text-sm line-clamp-3">{insight.content}</p>
            {insight.confidence && (
              <div className="mt-2">
                <Badge variant="outline" className="text-xs">
                  {Math.round(insight.confidence * 100)}% confidence
                </Badge>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
