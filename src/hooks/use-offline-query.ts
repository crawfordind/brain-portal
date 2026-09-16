"use client";

import { useQuery } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import { offlineDb, EntityType } from "@/lib/offline/db";
import { useSyncStatus } from "./use-sync-status";

interface OfflineQueryOptions<TData> {
  /** React Query key */
  queryKey: string[];
  /** Entity type for local storage */
  entityType: EntityType;
  /** Function to fetch from server */
  fetchFn: () => Promise<TData>;
  /** Transform local data to match expected format */
  transform?: (items: Record<string, unknown>[]) => TData;
  /** Filter function for local data */
  filter?: (item: Record<string, unknown>) => boolean;
  /** Sort function for local data */
  sort?: (a: Record<string, unknown>, b: Record<string, unknown>) => number;
  /** Whether query is enabled */
  enabled?: boolean;
}

/**
 * Hook for offline-aware queries
 * Uses local IndexedDB when offline, syncs with server when online
 */
export function useOfflineQuery<TData>(options: OfflineQueryOptions<TData>) {
  const { isOnline } = useSyncStatus();
  const { queryKey, entityType, fetchFn, transform, filter, sort, enabled = true } = options;

  // Live query from IndexedDB
  const localData = useLiveQuery(async () => {
    const table = getTable(entityType);
    let items = (await table.toArray()) as unknown as Record<string, unknown>[];

    if (filter) {
      items = items.filter(filter);
    }

    if (sort) {
      items = items.sort(sort);
    }

    return transform ? transform(items) : (items as unknown as TData);
  }, [entityType]);

  // Remote query (only when online and enabled)
  const remoteQuery = useQuery({
    queryKey,
    queryFn: async () => {
      const data = await fetchFn();

      // Update local cache with server data
      if (data && typeof data === "object") {
        await syncToLocal(entityType, data);
      }

      return data;
    },
    enabled: enabled && isOnline,
    staleTime: 60 * 1000, // 1 minute
  });

  // Prefer remote data when available and online, fall back to local
  const data =
    isOnline && remoteQuery.data !== undefined
      ? remoteQuery.data
      : (localData as TData);

  return {
    data,
    isLoading: isOnline ? remoteQuery.isLoading : localData === undefined,
    isError: isOnline ? remoteQuery.isError : false,
    error: remoteQuery.error,
    isOffline: !isOnline,
    refetch: remoteQuery.refetch,
  };
}

/**
 * Get the Dexie table for an entity type
 */
function getTable(entityType: EntityType) {
  switch (entityType) {
    case "note":
      return offlineDb.notes;
    case "capture":
      return offlineDb.captures;
    case "task":
      return offlineDb.tasks;
    case "project":
      return offlineDb.projects;
    case "dailyNote":
      return offlineDb.dailyNotes;
    case "tag":
      return offlineDb.tags;
  }
}

/**
 * Sync server response to local IndexedDB
 */
async function syncToLocal(entityType: EntityType, data: unknown): Promise<void> {
  const table = getTable(entityType);

  // Extract array of entities from response
  const listKeys: Record<EntityType, string> = {
    note: "notes",
    capture: "captures",
    task: "tasks",
    project: "projects",
    dailyNote: "dailyNotes",
    tag: "tags",
  };

  const key = listKeys[entityType];
  const entities = (data as Record<string, unknown>)[key];

  if (!Array.isArray(entities)) return;

  const timestamp = Date.now();

  for (const entity of entities) {
    if (typeof entity !== "object" || entity === null) continue;

    const entityId = (entity as { id: string }).id;
    const existing = await table.get(entityId);

    // Only update if local is synced (last-write-wins for pending local changes)
    if (!existing || existing._syncStatus === "synced") {
      await table.put({
        ...entity,
        _syncStatus: "synced",
        _lastModified: timestamp,
      } as never);
    }
  }
}
