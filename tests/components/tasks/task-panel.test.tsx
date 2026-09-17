import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TaskPanel } from "@/components/tasks/task-panel";
import { renderWithProviders } from "../../helpers/render";
import type { Task } from "@/types/task";

vi.mock("@/components/ui/confirm-dialog", () => ({
  useConfirm: () => vi.fn(async () => true),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const PROJECTS = [{ id: "p1", name: "Website" }];

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    user_id: "u1",
    note_id: null,
    project_id: null,
    content: "Email the supplier",
    title: "Email the supplier",
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
    recurrence_rule: null,
    recurrence_end_date: null,
    parent_task_id: null,
    tags: "[]",
    metadata: "{}",
    created_at: "2026-01-05T10:00:00Z",
    updated_at: "2026-01-05T10:00:00Z",
    project_name: null,
    note_title: null,
    note_slug: null,
    ...overrides,
  } as Task;
}

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn(async (url: RequestInfo | URL) => {
    const href = String(url);
    if (href.includes("/api/agents")) {
      return new Response(
        JSON.stringify({ agents: [{ agent_type: "research", display_name: "Research" }] }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    return new Response(JSON.stringify({ task: makeTask() }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
});

describe("TaskPanel", () => {
  it("opens straight into an editable title — no separate edit step", async () => {
    renderWithProviders(
      <TaskPanel task={makeTask()} open onClose={() => {}} projects={PROJECTS} />
    );

    // The heading IS the input. Previously this was read-only text plus an
    // Edit button that swapped in a second dialog.
    const title = await screen.findByDisplayValue("Email the supplier");
    expect(title).toBeEnabled();
    expect(screen.queryByRole("button", { name: /^edit$/i })).not.toBeInTheDocument();
  });

  it("offers delegation on an existing task, not only at creation", async () => {
    renderWithProviders(
      <TaskPanel task={makeTask()} open onClose={() => {}} projects={PROJECTS} />
    );

    // The whole point of the merge: an existing task can be handed to an agent.
    expect(await screen.findByText("Who does it")).toBeInTheDocument();
  });

  it("hides Save until something actually changes", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <TaskPanel task={makeTask()} open onClose={() => {}} projects={PROJECTS} />
    );

    await screen.findByDisplayValue("Email the supplier");
    expect(screen.queryByRole("button", { name: /save/i })).not.toBeInTheDocument();

    await user.type(screen.getByDisplayValue("Email the supplier"), " today");

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /save/i })).toBeInTheDocument()
    );
  });

  it("PUTs the edited task rather than creating a duplicate", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithProviders(
      <TaskPanel task={makeTask()} open onClose={onClose} projects={PROJECTS} />
    );

    await screen.findByDisplayValue("Email the supplier");
    await user.type(screen.getByDisplayValue("Email the supplier"), "!");
    await user.click(await screen.findByRole("button", { name: /save/i }));

    await waitFor(() => {
      const calls = vi.mocked(global.fetch).mock.calls.map(([u, init]) => ({
        url: String(u),
        method: (init as RequestInit | undefined)?.method,
      }));
      expect(calls).toContainEqual({ url: "/api/tasks/task-1", method: "PUT" });
    });
  });

  it("creates via POST when opened with no task", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <TaskPanel task={null} open onClose={() => {}} projects={PROJECTS} />
    );

    const title = await screen.findByPlaceholderText("What needs doing?");
    await user.type(title, "Draft the invoice");
    await user.click(await screen.findByRole("button", { name: /create task/i }));

    await waitFor(() => {
      const calls = vi.mocked(global.fetch).mock.calls.map(([u, init]) => ({
        url: String(u),
        method: (init as RequestInit | undefined)?.method,
      }));
      expect(calls).toContainEqual({ url: "/api/tasks", method: "POST" });
    });
  });

  it("shows the status control only for a task that exists", async () => {
    const { rerender } = renderWithProviders(
      <TaskPanel task={null} open onClose={() => {}} projects={PROJECTS} />
    );
    await screen.findByPlaceholderText("What needs doing?");
    expect(screen.queryByText("Status")).not.toBeInTheDocument();

    rerender(<TaskPanel task={makeTask()} open onClose={() => {}} projects={PROJECTS} />);
    expect(await screen.findByText("Status")).toBeInTheDocument();
  });
});
