import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TaskFilter } from "@/components/tasks/task-filter";

const mockProjects = [
  { id: "proj-1", name: "Project A" },
  { id: "proj-2", name: "Project B" },
];

// Mock scrollIntoView for Radix UI Select
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});

describe("TaskFilter", () => {
  it("renders project filter dropdown", () => {
    render(
      <TaskFilter
        selectedProject="all"
        onProjectChange={() => {}}
        projects={mockProjects}
      />
    );
    expect(screen.getByText("All Tasks")).toBeInTheDocument();
  });

  it("shows project options when opened", async () => {
    render(
      <TaskFilter
        selectedProject="all"
        onProjectChange={() => {}}
        projects={mockProjects}
      />
    );

    const trigger = screen.getByRole("combobox");
    fireEvent.click(trigger);

    await waitFor(() => {
      expect(screen.getByText("Project A")).toBeInTheDocument();
      expect(screen.getByText("Project B")).toBeInTheDocument();
    });
  });

  it("calls onProjectChange when project selected", async () => {
    const onChange = vi.fn();
    render(
      <TaskFilter
        selectedProject="all"
        onProjectChange={onChange}
        projects={mockProjects}
      />
    );

    const trigger = screen.getByRole("combobox");
    fireEvent.click(trigger);

    const option = await screen.findByText("Project A");
    fireEvent.click(option);

    expect(onChange).toHaveBeenCalledWith("proj-1");
  });
});
