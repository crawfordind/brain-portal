import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TaskCard } from "@/components/tasks/task-card";
import type { Task } from "@/types/task";

const mockTask: Task = {
  id: "task-1",
  user_id: "user-1",
  note_id: null,
  project_id: null,
  content: "Test task",
  title: "Test task",
  description: null,
  delegated_to: null,
  agent_task_id: null,
  linked_note_ids: "[]",
  status: "pending",
  priority: "medium",
  due_date: null,
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

describe("TaskCard", () => {
  it("renders task title", () => {
    render(<TaskCard task={mockTask} onClick={() => {}} />);
    expect(screen.getByText("Test task")).toBeInTheDocument();
  });

  it("shows priority indicator via border color", () => {
    render(<TaskCard task={mockTask} onClick={() => {}} />);
    const card = screen.getByRole("article");
    expect(card).toHaveClass("border-l-4");
  });

  it("displays due date when present", () => {
    const taskWithDue = { ...mockTask, due_date: "2024-03-15T00:00:00Z" };
    render(<TaskCard task={taskWithDue} onClick={() => {}} />);
    expect(screen.getByText(/mar/i)).toBeInTheDocument();
  });

  it("displays scheduled time when present", () => {
    const taskWithSchedule = { ...mockTask, scheduled_at: "2024-03-15T14:00:00Z" };
    render(<TaskCard task={taskWithSchedule} onClick={() => {}} />);
    // Time displays in local timezone
    expect(screen.getByText(/\d{1,2}:\d{2}\s*(AM|PM|am|pm)/i)).toBeInTheDocument();
  });

  it("shows project badge when assigned", () => {
    const taskWithProject = { ...mockTask, project_id: "proj-1", project_name: "My Project" };
    render(<TaskCard task={taskWithProject} onClick={() => {}} />);
    expect(screen.getByText("My Project")).toBeInTheDocument();
  });

  it("calls onClick when clicked", () => {
    const onClick = vi.fn();
    render(<TaskCard task={mockTask} onClick={onClick} />);
    fireEvent.click(screen.getByRole("article"));
    expect(onClick).toHaveBeenCalledWith(mockTask);
  });

  it("highlights overdue tasks", () => {
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 1);
    const overdueTask = {
      ...mockTask,
      due_date: pastDate.toISOString(),
      completed_at: null,
    };
    render(<TaskCard task={overdueTask} onClick={() => {}} />);
    const card = screen.getByRole("article");
    expect(card).toHaveClass("ring-2", "ring-red-500");
  });
});
