import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useTaskDrag } from "@/hooks/use-task-drag";

describe("useTaskDrag", () => {
  it("returns sensors and handleDragEnd function", () => {
    const onDrop = vi.fn();
    const { result } = renderHook(() => useTaskDrag(onDrop));

    expect(result.current.sensors).toBeDefined();
    expect(typeof result.current.handleDragEnd).toBe("function");
  });

  it("calls onDrop when drag ends with valid drop", () => {
    const onDrop = vi.fn();
    const { result } = renderHook(() => useTaskDrag(onDrop));

    const mockEvent = {
      active: { id: "task-1" },
      over: { id: "completed" },
    };

    result.current.handleDragEnd(mockEvent as any);

    expect(onDrop).toHaveBeenCalledWith("task-1", "completed");
  });

  it("does not call onDrop when no over target", () => {
    const onDrop = vi.fn();
    const { result } = renderHook(() => useTaskDrag(onDrop));

    const mockEvent = {
      active: { id: "task-1" },
      over: null,
    };

    result.current.handleDragEnd(mockEvent as any);

    expect(onDrop).not.toHaveBeenCalled();
  });
});
