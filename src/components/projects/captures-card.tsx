import { formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Package, Lightbulb, MessageSquare, Quote, Link as LinkIcon } from "lucide-react";
import { Capture } from "@/lib/db/schema";

interface CapturesCardProps {
  captures: Capture[];
}

const CAPTURE_TYPE_CONFIG: Record<string, { icon: React.ReactNode; color: string }> = {
  thought: { icon: <MessageSquare className="h-3 w-3" />, color: "bg-blue-500/10 text-blue-600" },
  idea: { icon: <Lightbulb className="h-3 w-3" />, color: "bg-yellow-500/10 text-yellow-600" },
  quote: { icon: <Quote className="h-3 w-3" />, color: "bg-purple-500/10 text-purple-600" },
  link: { icon: <LinkIcon className="h-3 w-3" />, color: "bg-green-500/10 text-green-600" },
  task: { icon: <Package className="h-3 w-3" />, color: "bg-orange-500/10 text-orange-600" },
};

export function CapturesCard({ captures }: CapturesCardProps) {
  if (captures.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-4">
        No captures linked. Link captures from the captures page.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {captures.map((capture) => {
        const config = CAPTURE_TYPE_CONFIG[capture.capture_type] || CAPTURE_TYPE_CONFIG.thought;

        return (
          <div
            key={capture.id}
            className="p-3 rounded-lg border hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-start gap-2 mb-2">
              <Badge variant="secondary" className={`${config.color} shrink-0`}>
                {config.icon}
                <span className="ml-1 text-xs capitalize">{capture.capture_type}</span>
              </Badge>
              <span className="text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(capture.captured_at), { addSuffix: true })}
              </span>
            </div>
            <p className="text-sm line-clamp-3">{capture.content}</p>
          </div>
        );
      })}
    </div>
  );
}
