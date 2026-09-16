import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders as render } from "../../helpers/render";
import { TaskDetailPanel } from "@/components/tasks/task-detail-panel";
import type { Task } from "@/types/task";

const mockTask: Task = {
  id: "task-1",
  user_id: "user-1",
  note_id: null,
  project_id: null,
  content: "Test task",
  title: "Test task",
  description: "Task description",
  delegated_to: null,
  agent_task_id: null,
  linked_note_ids: "[]",
  status: "pending",
  priority: "medium",
  due_date: "2024-03-15T00:00:00Z",
  scheduled_at: null,
  estimated_completion_date: null,
  completed_at: null,
  estimation_accuracy: null,
  position: 0,
  tags: "[]",
  metadata: "{}",
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
  project_name: null,
  note_title: null,
  note_slug: null,
  recurrence_rule: null,
  recurrence_end_date: null,
  parent_task_id: null,
};

describe("TaskDetailPanel", () => {
  it("renders task title", () => {
    render(<TaskDetailPanel task={mockTask} open={true} onClose={() => {}} />);
    expect(screen.getByText("Test task")).toBeInTheDocument();
  });

  it("displays task description", () => {
    render(<TaskDetailPanel task={mockTask} open={true} onClose={() => {}} />);
    expect(screen.getByText("Task description")).toBeInTheDocument();
  });

  it("shows quick action buttons", () => {
    render(
      <TaskDetailPanel
        task={mockTask}
        open={true}
        onClose={() => {}}
        onComplete={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
      />
    );
    expect(screen.getByText(/complete/i)).toBeInTheDocument();
    expect(screen.getByText(/edit/i)).toBeInTheDocument();
    expect(screen.getByText(/delete/i)).toBeInTheDocument();
  });

  it("calls onClose when close button clicked", () => {
    const onClose = vi.fn();
    render(<TaskDetailPanel task={mockTask} open={true} onClose={onClose} />);

    const closeButton = screen.getByLabelText(/close/i);
    fireEvent.click(closeButton);

    expect(onClose).toHaveBeenCalled();
  });

  it("does not render when open is false", () => {
    render(<TaskDetailPanel task={mockTask} open={false} onClose={() => {}} />);
    expect(screen.queryByText("Test task")).not.toBeInTheDocument();
  });

  it("calls onComplete when complete button clicked", () => {
    const onComplete = vi.fn();
    render(
      <TaskDetailPanel
        task={mockTask}
        open={true}
        onClose={() => {}}
        onComplete={onComplete}
      />
    );

    fireEvent.click(screen.getByText(/complete/i));
    expect(onComplete).toHaveBeenCalledWith(mockTask);
  });
});
