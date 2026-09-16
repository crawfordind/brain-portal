import { Badge } from "@/components/ui/badge";
import { ArrowRight, Link2, Zap } from "lucide-react";
import Link from "next/link";

interface NoteConnection {
  id: string;
  source_note_id: string;
  target_note_id: string;
  connection_type: string;
  strength: number;
  reason: string | null;
  is_manual: boolean;
  source_title: string;
  target_title: string;
  created_at: string;
}

interface NoteConnectionsCardProps {
  connections: NoteConnection[];
}

const CONNECTION_TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  similar: { label: "Similar", color: "bg-blue-500/10 text-blue-600" },
  references: { label: "References", color: "bg-green-500/10 text-green-600" },
  builds_on: { label: "Builds On", color: "bg-purple-500/10 text-purple-600" },
  related: { label: "Related", color: "bg-orange-500/10 text-orange-600" },
};

export function NoteConnectionsCard({ connections }: NoteConnectionsCardProps) {
  if (connections.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-4">
        No note connections yet
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {connections.map((conn) => {
        const config = CONNECTION_TYPE_CONFIG[conn.connection_type] || CONNECTION_TYPE_CONFIG.related;
        const strengthPercent = Math.round(conn.strength * 100);
        const strengthColor = conn.strength >= 0.8
          ? "text-green-600"
          : conn.strength >= 0.6
          ? "text-yellow-600"
          : "text-gray-600";

        return (
          <div
            key={conn.id}
            className="p-3 rounded-lg border hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-start gap-2 mb-2">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <Link2 className="h-4 w-4 text-muted-foreground shrink-0" />
                <Badge variant="outline" className={`${config.color} text-xs shrink-0`}>
                  {config.label}
                </Badge>
                {conn.is_manual && (
                  <Badge variant="secondary" className="text-xs shrink-0">
                    Manual
                  </Badge>
                )}
              </div>
              <div className={`flex items-center gap-1 text-xs font-medium ${strengthColor} shrink-0`}>
                <Zap className="h-3 w-3" />
                <span>{strengthPercent}%</span>
              </div>
            </div>

            <div className="flex items-center gap-2 text-sm">
              <Link
                href={`/notes/${conn.source_note_id}`}
                className="flex-1 min-w-0 truncate font-medium hover:underline"
              >
                {conn.source_title}
              </Link>
              <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
              <Link
                href={`/notes/${conn.target_note_id}`}
                className="flex-1 min-w-0 truncate font-medium hover:underline"
              >
                {conn.target_title}
              </Link>
            </div>

            {conn.reason && (
              <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
                {conn.reason}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
