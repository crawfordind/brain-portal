import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the database client
const mockQueryAll = vi.fn();
const mockQueryOne = vi.fn();
const mockDbExecute = vi.fn();

vi.mock("@/lib/db/client", () => ({
  db: { execute: (...args: unknown[]) => mockDbExecute(...args) },
  queryAll: (...args: unknown[]) => mockQueryAll(...args),
  queryOne: (...args: unknown[]) => mockQueryOne(...args),
}));

// Mock notification engine
const mockCreateNotification = vi.fn();
vi.mock("@/lib/notifications/engine", () => ({
  createNotification: (...args: unknown[]) => mockCreateNotification(...args),
}));

// Mock the skills module. The engine imports it for execute_skill dispatch,
// and its transitive imports eagerly construct the OpenAI client at module
// load — which throws without an API key. Mocking keeps the engine loadable.
const mockExecuteSkill = vi.fn();
vi.mock("@/lib/skills", () => ({
  executeSkill: (...args: unknown[]) => mockExecuteSkill(...args),
  initializeSkills: vi.fn(),
}));

import { executeHeartbeatTick, getHeartbeatTasks, getHeartbeatLogs } from "@/lib/heartbeat/engine";
import type { HeartbeatTask } from "@/lib/db/schema";

function makeTask(overrides: Partial<HeartbeatTask> = {}): HeartbeatTask {
  return {
    id: "task-1",
    user_id: "user-1",
    name: "test_task",
    description: "Test heartbeat task",
    check_type: "rule_eval",
    check_source: JSON.stringify({ rule: "overdue_tasks" }),
    condition: "count > 0",
    action_type: "create_notification",
    action_params: JSON.stringify({
      title: "Test",
      body: "Found {count} items",
      priority: "high",
      type: "system",
    }),
    schedule: "30m",
    enabled: 1,
    owner: "system",
    notify_channel: "in_app",
    last_run_at: null,
    last_result: null,
    run_count: 0,
    error_count: 0,
    created_at: "2026-01-01T00:00:00",
    updated_at: "2026-01-01T00:00:00",
    ...overrides,
  };
}

describe("Heartbeat Engine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbExecute.mockResolvedValue({ rowsAffected: 1 });
    mockCreateNotification.mockResolvedValue("notif-1");
    mockExecuteSkill.mockResolvedValue({ success: true, durationMs: 1 });
  });

  describe("executeHeartbeatTick", () => {
    it("should skip tasks that are not due", async () => {
      const recentTask = makeTask({
        last_run_at: new Date().toISOString().replace("Z", ""),
        schedule: "1h",
      });

      // Return one task that was just run
      mockQueryAll.mockResolvedValueOnce([recentTask]);

      const result = await executeHeartbeatTick();

      expect(result.tasksSkipped).toBe(1);
      expect(result.tasksEvaluated).toBe(0);
      expect(result.tasksTriggered).toBe(0);
    });

    it("should evaluate tasks with no last_run_at", async () => {
      const task = makeTask({ last_run_at: null });

      // First call: get all enabled tasks
      mockQueryAll.mockResolvedValueOnce([task]);
      // Second call: rule_eval query for overdue_tasks
      mockQueryAll.mockResolvedValueOnce([
        { id: "t1", content: "Overdue task", title: "Task 1", due_date: "2026-01-01", priority: "high", user_id: "user-1" },
      ]);

      const result = await executeHeartbeatTick();

      expect(result.tasksEvaluated).toBe(1);
      expect(result.tasksTriggered).toBe(1);
      expect(mockCreateNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-1",
          title: "Test",
          body: "Found 1 items",
        })
      );
    });

    it("should not trigger when condition is not met", async () => {
      const task = makeTask({ condition: "count >= 5" });

      mockQueryAll.mockResolvedValueOnce([task]);
      // Rule returns only 2 items (< 5)
      mockQueryAll.mockResolvedValueOnce([{ id: "t1" }, { id: "t2" }]);

      const result = await executeHeartbeatTick();

      expect(result.tasksEvaluated).toBe(1);
      expect(result.tasksTriggered).toBe(0);
      expect(mockCreateNotification).not.toHaveBeenCalled();
    });

    it("should handle errors gracefully", async () => {
      const task = makeTask({
        check_type: "rule_eval",
        check_source: JSON.stringify({ rule: "unknown_rule_xyz" }),
      });

      mockQueryAll.mockResolvedValueOnce([task]);

      const result = await executeHeartbeatTick();

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("Unknown rule");
    });

    it("should return empty result when no tasks exist", async () => {
      mockQueryAll.mockResolvedValueOnce([]);

      const result = await executeHeartbeatTick();

      expect(result.tasksEvaluated).toBe(0);
      expect(result.tasksTriggered).toBe(0);
      expect(result.tasksSkipped).toBe(0);
    });

    it("should process db_query check type", async () => {
      const task = makeTask({
        check_type: "db_query",
        check_source: JSON.stringify({
          query: "SELECT id FROM tasks WHERE status = 'pending'",
          args: [],
        }),
      });

      mockQueryAll.mockResolvedValueOnce([task]);
      mockQueryAll.mockResolvedValueOnce([{ id: "row-1" }, { id: "row-2" }]);

      const result = await executeHeartbeatTick();

      expect(result.tasksTriggered).toBe(1);
    });

    it("should reject non-SELECT queries in db_query", async () => {
      const task = makeTask({
        check_type: "db_query",
        check_source: JSON.stringify({
          query: "DELETE FROM tasks WHERE 1=1",
        }),
      });

      mockQueryAll.mockResolvedValueOnce([task]);

      const result = await executeHeartbeatTick();

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("Only SELECT queries");
    });

    it("should handle stale_check type", async () => {
      const task = makeTask({
        check_type: "stale_check",
        check_source: JSON.stringify({
          entity_type: "notes",
          stale_after: "7d",
        }),
      });

      mockQueryAll.mockResolvedValueOnce([task]);
      mockQueryAll.mockResolvedValueOnce([{ id: "n1", updated_at: "2025-01-01" }]);

      const result = await executeHeartbeatTick();

      expect(result.tasksTriggered).toBe(1);
    });

    it("should trigger stale_insights when insights are old but notes are fresh", async () => {
      const task = makeTask({
        check_source: JSON.stringify({ rule: "stale_insights" }),
        action_params: JSON.stringify({
          title: "AI insights have stalled",
          body: "No new AI insights in over a week.",
          priority: "high",
          type: "system",
        }),
      });

      mockQueryAll.mockResolvedValueOnce([task]);
      // stale_insights uses queryOne for its stats
      mockQueryOne.mockResolvedValueOnce({
        last_generated_at: "2026-01-01 00:00:00", // long ago
        recent_notes: 5,
      });

      const result = await executeHeartbeatTick();

      expect(result.tasksTriggered).toBe(1);
      expect(mockCreateNotification).toHaveBeenCalledWith(
        expect.objectContaining({ title: "AI insights have stalled" })
      );
    });

    it("should trigger stale_insights when no insights exist but notes are fresh", async () => {
      const task = makeTask({
        check_source: JSON.stringify({ rule: "stale_insights" }),
      });

      mockQueryAll.mockResolvedValueOnce([task]);
      mockQueryOne.mockResolvedValueOnce({
        last_generated_at: null,
        recent_notes: 4,
      });

      const result = await executeHeartbeatTick();

      expect(result.tasksTriggered).toBe(1);
    });

    it("should NOT trigger stale_insights when there is little recent material", async () => {
      const task = makeTask({
        check_source: JSON.stringify({ rule: "stale_insights" }),
      });

      mockQueryAll.mockResolvedValueOnce([task]);
      mockQueryOne.mockResolvedValueOnce({
        last_generated_at: null,
        recent_notes: 1, // below the >= 3 threshold
      });

      const result = await executeHeartbeatTick();

      expect(result.tasksTriggered).toBe(0);
      expect(mockCreateNotification).not.toHaveBeenCalled();
    });

    it("should NOT trigger stale_insights when a recent insight exists", async () => {
      const task = makeTask({
        check_source: JSON.stringify({ rule: "stale_insights" }),
      });

      // An insight generated just now (UTC, no tz marker — engine appends "Z").
      const nowUtc = new Date().toISOString().replace("T", " ").replace("Z", "");

      mockQueryAll.mockResolvedValueOnce([task]);
      mockQueryOne.mockResolvedValueOnce({
        last_generated_at: nowUtc,
        recent_notes: 10,
      });

      const result = await executeHeartbeatTick();

      expect(result.tasksTriggered).toBe(0);
    });

    it("should dispatch enqueue_processing action", async () => {
      const task = makeTask({
        action_type: "enqueue_processing",
        action_params: JSON.stringify({
          operation: "generate_embedding",
          tier: "embedding",
          entity_type: "note",
        }),
      });

      mockQueryAll.mockResolvedValueOnce([task]);
      mockQueryAll.mockResolvedValueOnce([{ id: "n1" }, { id: "n2" }]);
      // Duplicate check returns null (no existing jobs)
      mockQueryOne.mockResolvedValue(null);

      const result = await executeHeartbeatTick();

      expect(result.tasksTriggered).toBe(1);
      // Should enqueue 2 processing jobs + 2 log entries
      expect(mockDbExecute).toHaveBeenCalled();
    });
  });

  describe("getHeartbeatTasks", () => {
    it("should query tasks for a user", async () => {
      const tasks = [makeTask()];
      mockQueryAll.mockResolvedValueOnce(tasks);

      const result = await getHeartbeatTasks("user-1");

      expect(result).toEqual(tasks);
      expect(mockQueryAll).toHaveBeenCalledWith(
        expect.stringContaining("heartbeat_tasks"),
        ["user-1"]
      );
    });
  });

  describe("getHeartbeatLogs", () => {
    it("should query logs for a user", async () => {
      mockQueryAll.mockResolvedValueOnce([]);

      await getHeartbeatLogs("user-1");

      expect(mockQueryAll).toHaveBeenCalledWith(
        expect.stringContaining("heartbeat_logs"),
        ["user-1", 50]
      );
    });

    it("should filter by task id when provided", async () => {
      mockQueryAll.mockResolvedValueOnce([]);

      await getHeartbeatLogs("user-1", "task-1", 10);

      expect(mockQueryAll).toHaveBeenCalledWith(
        expect.stringContaining("heartbeat_task_id"),
        ["user-1", "task-1", 10]
      );
    });
  });
});
