"use client";

import { useQuery } from "@tanstack/react-query";

export interface ProjectItem {
  id: string;
  name: string;
  slug: string;
  color: string | null;
  status: string;
}

export function useProjects() {
  return useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const response = await fetch("/api/projects");
      if (!response.ok) throw new Error("Failed to fetch projects");
      const data = await response.json();
      return (data.projects ?? []) as ProjectItem[];
    },
    staleTime: 1000 * 60, // 1 minute
  });
}
