"use client";

import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { DraggableTask } from "./time-slot";
import type { Task } from "@/types/task";

interface BacklogSidebarProps {
  tasks: Task[];
  onTaskClick: (task: Task) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

export function BacklogSidebar({
  tasks,
  onTaskClick,
  searchQuery,
  onSearchChange,
}: BacklogSidebarProps) {
  return (
    <aside className="w-80 border-l bg-muted/30 flex flex-col">
      <div className="p-4 border-b">
        <h2 className="text-lg font-semibold mb-3">
          📋 Task Backlog ({tasks.length})
        </h2>

        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search tasks..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-8"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {tasks.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">✅</div>
            <h3 className="text-lg font-semibold mb-2">All Scheduled!</h3>
            <p className="text-sm text-muted-foreground">
              Time to execute!
            </p>
          </div>
        ) : (
          tasks.map((task) => (
            <DraggableTask
              key={task.id}
              task={task}
              onTaskClick={onTaskClick}
            />
          ))
        )}
      </div>
    </aside>
  );
}
