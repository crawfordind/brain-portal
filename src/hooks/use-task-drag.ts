import { useSensor, useSensors, PointerSensor, KeyboardSensor, TouchSensor, DragEndEvent } from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";

export function useTaskDrag(onDrop?: (taskId: string, newStatus: string) => void) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 15, // 15px movement required to start drag
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 300, // 300ms hold before drag starts (matches long-press)
        tolerance: 8, // 8px movement tolerance
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || !onDrop) return;

    const taskId = active.id as string;
    const newStatus = over.id as string;

    onDrop(taskId, newStatus);
  };

  return {
    sensors,
    handleDragEnd,
  };
}
