"use client";

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { CommandResult } from '@/lib/stores/command-store';

interface RecentItem {
  entity_type: string;
  entity_id: string;
  title?: string;
  content?: string;
  created_at: string;
  updated_at: string;
}

interface RecentItemsResponse {
  notes: RecentItem[];
  tasks: RecentItem[];
  captures: RecentItem[];
  projects: RecentItem[];
}

async function fetchRecentItems(): Promise<CommandResult[]> {
  try {
    // Fetch recent activity from the activity log
    const response = await fetch('/api/activity/recent?limit=10');

    if (!response.ok) {
      throw new Error('Failed to fetch recent items');
    }

    const data: RecentItemsResponse = await response.json();
    const results: CommandResult[] = [];

    // Convert notes to command results
    if (data.notes) {
      for (const note of data.notes) {
        results.push({
          id: `note-${note.entity_id}`,
          type: 'note',
          label: note.title || 'Untitled Note',
          description: note.content ? note.content.substring(0, 100) : undefined,
          icon: 'FileText',
          section: 'recent',
          url: `/notes/${note.entity_id}`,
        });
      }
    }

    // Convert tasks to command results
    if (data.tasks) {
      for (const task of data.tasks) {
        results.push({
          id: `task-${task.entity_id}`,
          type: 'task',
          label: task.content || 'Untitled Task',
          icon: 'CheckSquare',
          section: 'recent',
          url: `/tasks?id=${task.entity_id}`,
        });
      }
    }

    // Convert captures to command results
    if (data.captures) {
      for (const capture of data.captures) {
        results.push({
          id: `capture-${capture.entity_id}`,
          type: 'capture',
          label: capture.content ? capture.content.substring(0, 50) : 'Quick Capture',
          icon: 'Mic',
          section: 'recent',
          url: `/captures?id=${capture.entity_id}`,
        });
      }
    }

    // Convert projects to command results
    if (data.projects) {
      for (const project of data.projects) {
        results.push({
          id: `project-${project.entity_id}`,
          type: 'project',
          label: project.title || 'Untitled Project',
          icon: 'FolderOpen',
          section: 'recent',
          url: `/projects/${project.entity_id}`,
        });
      }
    }

    return results;
  } catch (error) {
    console.error('Error fetching recent items:', error);
    return [];
  }
}

export function useRecentItems() {
  const [isMounted, setIsMounted] = useState(false);

  // Prevent query from running during SSR/hydration
  useEffect(() => {
    setIsMounted(true);
  }, []);

  const query = useQuery({
    queryKey: ['recent-items'],
    queryFn: fetchRecentItems,
    staleTime: 1000 * 60 * 5, // 5 minutes
    gcTime: 1000 * 60 * 10, // 10 minutes (formerly cacheTime)
    enabled: isMounted, // Only run query after component mounts
  });

  return {
    recentItems: query.data || [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
