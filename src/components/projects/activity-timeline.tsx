import { formatDistanceToNow } from "date-fns";
import { FileText, CheckSquare, FolderOpen, Edit } from "lucide-react";

interface Activity {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  changes: string;
  created_at: string;
}

interface ActivityTimelineProps {
  activities: Activity[];
}

const ENTITY_ICONS: Record<string, React.ReactNode> = {
  note: <FileText className="h-4 w-4" />,
  task: <CheckSquare className="h-4 w-4" />,
  project: <FolderOpen className="h-4 w-4" />,
};

const ACTION_LABELS: Record<string, string> = {
  created: "created",
  updated: "updated",
  deleted: "deleted",
  completed: "completed",
};

function groupByDate(activities: Activity[]) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const thisWeek = new Date(today);
  thisWeek.setDate(thisWeek.getDate() - 7);

  const groups: Record<string, Activity[]> = {
    Today: [],
    Yesterday: [],
    "This Week": [],
    Older: [],
  };

  activities.forEach((activity) => {
    const activityDate = new Date(activity.created_at);
    if (activityDate >= today) {
      groups.Today.push(activity);
    } else if (activityDate >= yesterday) {
      groups.Yesterday.push(activity);
    } else if (activityDate >= thisWeek) {
      groups["This Week"].push(activity);
    } else {
      groups.Older.push(activity);
    }
  });

  return groups;
}

export function ActivityTimeline({ activities }: ActivityTimelineProps) {
  if (activities.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-4">
        No recent activity
      </p>
    );
  }

  const grouped = groupByDate(activities);

  return (
    <div className="space-y-4">
      {Object.entries(grouped).map(([groupName, groupActivities]) => {
        if (groupActivities.length === 0) return null;

        return (
          <div key={groupName}>
            <h4 className="text-sm font-semibold mb-2 text-muted-foreground">
              {groupName}
            </h4>
            <div className="space-y-2">
              {groupActivities.map((activity) => (
                <div
                  key={activity.id}
                  className="flex items-start gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div className="mt-0.5 text-muted-foreground">
                    {ENTITY_ICONS[activity.entity_type] || <Edit className="h-4 w-4" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">
                      <span className="capitalize">{activity.entity_type}</span>{" "}
                      <span className="text-muted-foreground">
                        {ACTION_LABELS[activity.action] || activity.action}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(activity.created_at), {
                        addSuffix: true,
                      })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
