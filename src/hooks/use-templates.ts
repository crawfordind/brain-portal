"use client";

import { useQuery } from "@tanstack/react-query";
import type { NoteTemplate, SeriesSuggestion, TemplateDraft } from "@/lib/templates/types";

/** A failed template call, carrying the server's own words. */
export class TemplateRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
  }
}

export async function templateFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new TemplateRequestError(data.error || "Something went wrong", res.status, data.code);
  }
  return data as T;
}

export function useTemplates(projectId?: string | null) {
  return useQuery({
    queryKey: ["templates", projectId ?? null],
    queryFn: async () => {
      try {
        const data = await templateFetch<{ templates: NoteTemplate[] }>(
          `/api/templates${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`
        );
        return { templates: data.templates, notMigrated: false };
      } catch (error) {
        if (error instanceof TemplateRequestError && error.code === "NOT_MIGRATED") {
          return { templates: [] as NoteTemplate[], notMigrated: true };
        }
        throw error;
      }
    },
    staleTime: 30_000,
  });
}

export function useTemplateSuggestions(projectId: string | null, enabled = true) {
  return useQuery({
    queryKey: ["templates", "suggestions", projectId],
    queryFn: () =>
      templateFetch<{ suggestions: SeriesSuggestion[]; scanned: number }>(
        `/api/templates/suggestions${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`
      ),
    enabled,
    staleTime: 60_000,
  });
}

export type DraftRequest =
  | { mode: "describe"; description: string; projectId?: string | null }
  | { mode: "notes"; noteIds?: string[]; seriesKey?: string; projectId?: string | null; instructions?: string }
  | { mode: "headings"; seriesKey: string; projectId?: string | null };

export type DraftWithProject = TemplateDraft & { project_id: string | null };

export function requestDraft(body: DraftRequest) {
  return templateFetch<{ draft: DraftWithProject; model?: string }>("/api/templates/draft", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
