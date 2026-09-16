import { formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Target, FileText, Package, Plus } from "lucide-react";
import { TaskRecommendation } from "@/lib/db/schema";

interface TaskRecommendationsCardProps {
  recommendations: TaskRecommendation[];
}

const SOURCE_TYPE_CONFIG: Record<string, { icon: React.ReactNode; label: string }> = {
  note: { icon: <FileText className="h-3 w-3" />, label: "Note" },
  daily_note: { icon: <FileText className="h-3 w-3" />, label: "Daily Note" },
  capture: { icon: <Package className="h-3 w-3" />, label: "Capture" },
};

export function TaskRecommendationsCard({ recommendations }: TaskRecommendationsCardProps) {
  if (recommendations.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-4">
        No task recommendations yet
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {recommendations.map((rec) => {
        const sourceConfig = SOURCE_TYPE_CONFIG[rec.source_type] || SOURCE_TYPE_CONFIG.note;
        const confidencePercent = Math.round(rec.confidence * 100);
        const confidenceColor = rec.confidence >= 0.8
          ? "bg-green-500/10 text-green-600"
          : rec.confidence >= 0.6
          ? "bg-yellow-500/10 text-yellow-600"
          : "bg-gray-500/10 text-gray-600";

        return (
          <div
            key={rec.id}
            className="p-3 rounded-lg border hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <Target className="h-4 w-4 text-blue-600 shrink-0" />
                <Badge variant="secondary" className="text-xs">
                  {sourceConfig.icon}
                  <span className="ml-1">{sourceConfig.label}</span>
                </Badge>
                <Badge variant="outline" className={`${confidenceColor} text-xs`}>
                  {confidencePercent}%
                </Badge>
              </div>
              <span className="text-xs text-muted-foreground shrink-0">
                {formatDistanceToNow(new Date(rec.created_at), { addSuffix: true })}
              </span>
            </div>

            <p className="text-sm font-medium mb-1">{rec.recommended_task}</p>

            {rec.reasoning && (
              <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
                {rec.reasoning}
              </p>
            )}

            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="h-7 text-xs">
                <Plus className="h-3 w-3 mr-1" />
                Create Task
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
