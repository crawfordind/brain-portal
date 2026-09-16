export interface Task {
  id: string;
  user_id: string;
  note_id: string | null;
  project_id: string | null;
  content: string;
  title: string | null;
  description: string | null;
  delegated_to: string | null;
  agent_task_id: string | null;
  linked_note_ids: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  priority: "low" | "medium" | "high" | "urgent";
  due_date: string | null;
  scheduled_at: string | null;
  estimated_completion_date: string | null;
  completed_at: string | null;
  estimation_accuracy: string | null;
  position: number;
  recurrence_rule: string | null;
  recurrence_end_date: string | null;
  parent_task_id: string | null;
  tags: string;
  metadata: string;
  created_at: string;
  updated_at: string;
  // Joined fields
  project_name: string | null;
  note_title: string | null;
  note_slug: string | null;
}

export interface EstimationAccuracy {
  estimated: string; // ISO date
  actual: string; // ISO date
  variance_days: number;
}

export interface TaskFilters {
  status?: "all" | "open" | "completed";
  project?: string;
  assignee?: "all" | "user" | "ai";
  dateRange?: {
    start: string;
    end: string;
  };
}
