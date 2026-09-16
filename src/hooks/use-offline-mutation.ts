"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { offlineDb, EntityType, SyncOperation, generateTempId, now, nowISO } from "@/lib/offline/db";
import { enqueueSync } from "@/lib/offline/sync-queue";
import { useSyncStatus } from "./use-sync-status";

/**
 * Wrap a promise with a timeout
 */
function withTimeout<T>(promise: Promise<T>, ms: number, errorMessage: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(errorMessage)), ms)
    ),
  ]);
}

interface OfflineMutationOptions<TVariables> {
  /** The entity type being mutated */
  entityType: EntityType;
  /** The operation being performed */
  operation: SyncOperation;
  /** Query keys to invalidate on success */
  queryKeys: string[][];
  /** Transform variables to payload for API */
  toPayload: (variables: TVariables) => Record<string, unknown>;
  /** Transform variables to local DB record (for create/update) */
  toLocalRecord?: (variables: TVariables, tempId: string) => Record<string, unknown>;
  /** Whether this operation requires AI (will fail offline) */
  requiresAI?: boolean;
  /** Callback on success */
  onSuccess?: () => void;
  /** Callback on error */
  onError?: (error: Error) => void;
}

/**
 * Hook for offline-aware mutations
 * Handles optimistic updates to IndexedDB and queues changes for sync
 */
export function useOfflineMutation<TVariables extends Record<string, unknown>>(
  options: OfflineMutationOptions<TVariables>
) {
  const queryClient = useQueryClient();
  const { isOnline, triggerSync } = useSyncStatus();

  return useMutation<unknown, Error, TVariables>({
    mutationFn: async (variables) => {
      // Wrap entire mutation in a 10-second timeout to prevent hanging
      return withTimeout(
        performMutation(variables, options, isOnline),
        10000,
        "Operation timed out. Please try again."
      );
    },

    onSuccess: () => {
      // Invalidate related queries
      for (const queryKey of options.queryKeys) {
        queryClient.invalidateQueries({ queryKey });
      }

      options.onSuccess?.();

      // Trigger background sync if online
      if (isOnline) {
        triggerSync();
      }
    },

    onError: (error) => {
      options.onError?.(error);
    },
  });
}

/**
 * Core mutation logic extracted for timeout wrapper
 */
async function performMutation<TVariables extends Record<string, unknown>>(
  variables: TVariables,
  options: OfflineMutationOptions<TVariables>,
  isOnline: boolean
): Promise<unknown> {
  const { entityType, operation, toPayload, toLocalRecord, requiresAI } = options;

  // Skip AI operations when offline
  if (requiresAI && !isOnline) {
    throw new Error("This feature requires an internet connection");
  }

  const timestamp = now();
  const payload = toPayload(variables);
  const variableId = (variables as { id?: string }).id;

  // Try online first if available
  if (isOnline) {
    try {
      const result = await performServerMutation(entityType, operation, variableId, payload);

      // Try to update local cache (non-blocking)
      updateLocalCache(entityType, operation, variableId, result, timestamp).catch((err) =>
        console.warn("Failed to update local cache:", err)
      );

      return result;
    } catch (error) {
      console.warn("Server mutation failed, trying offline mode:", error);
      // Fall through to offline mode
    }
  }

  // Offline or server failed: Save to localStorage as simple fallback
  // This is more reliable than IndexedDB on some mobile browsers
  return saveOffline(entityType, operation, variableId, payload, toLocalRecord, variables, timestamp);
}

/**
 * Save to IndexedDB with localStorage fallback
 */
async function saveOffline<TVariables extends Record<string, unknown>>(
  entityType: EntityType,
  operation: SyncOperation,
  variableId: string | undefined,
  payload: Record<string, unknown>,
  toLocalRecord: ((variables: TVariables, tempId: string) => Record<string, unknown>) | undefined,
  variables: TVariables,
  timestamp: number
): Promise<unknown> {
  const tempId = generateTempId();

  // Try IndexedDB first
  try {
    await offlineDb.open();
    const table = getTable(entityType);

    if (operation === "create") {
      const localRecord = toLocalRecord?.(variables, tempId) || {
        id: tempId,
        ...payload,
        created_at: nowISO(),
        updated_at: nowISO(),
      };

      await table.put({
        ...localRecord,
        id: tempId,
        _syncStatus: "pending",
        _lastModified: timestamp,
      } as never);

      await enqueueSync(entityType, tempId, operation, payload);
      return { [entityType]: { id: tempId, ...payload } };
    }

    if (operation === "update" && variableId) {
      await table.update(variableId, {
        ...payload,
        updated_at: nowISO(),
        _syncStatus: "pending",
        _lastModified: timestamp,
      } as never);

      await enqueueSync(entityType, variableId, operation, payload);
      return { [entityType]: { id: variableId, ...payload } };
    }

    if (operation === "delete" && variableId) {
      await table.delete(variableId);
      await enqueueSync(entityType, variableId, operation, {});
      return { success: true };
    }
  } catch (idbError) {
    console.warn("IndexedDB failed, using localStorage fallback:", idbError);

    // Fallback to localStorage for creates
    if (operation === "create") {
      const pendingKey = `pending_${entityType}_${tempId}`;
      const pendingItem = {
        id: tempId,
        entityType,
        operation,
        payload,
        timestamp,
        created_at: nowISO(),
      };

      try {
        localStorage.setItem(pendingKey, JSON.stringify(pendingItem));

        // Also track in a list for later sync
        const pendingList = JSON.parse(localStorage.getItem("pendingSync") || "[]");
        pendingList.push(pendingKey);
        localStorage.setItem("pendingSync", JSON.stringify(pendingList));

        return { [entityType]: { id: tempId, ...payload }, _offlineStorage: "localStorage" };
      } catch (lsError) {
        console.error("localStorage also failed:", lsError);
        throw new Error("Unable to save offline. Storage unavailable.");
      }
    }
  }

  throw new Error(`Failed to save ${operation} offline`);
}

/**
 * Update local IndexedDB cache after successful server response
 */
async function updateLocalCache(
  entityType: EntityType,
  operation: SyncOperation,
  variableId: string | undefined,
  result: unknown,
  timestamp: number
): Promise<void> {
  try {
    await offlineDb.open();
    const table = getTable(entityType);

    if (operation === "delete" && variableId) {
      await table.delete(variableId);
    } else {
      const serverEntity = extractEntity(result, entityType);
      if (serverEntity) {
        await table.put({
          ...serverEntity,
          _syncStatus: "synced",
          _lastModified: timestamp,
        } as never);
      }
    }
  } catch (error) {
    // Non-critical error
    throw error;
  }
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
 * Extract entity from API response
 */
function extractEntity(
  result: unknown,
  entityType: EntityType
): Record<string, unknown> | null {
  if (typeof result !== "object" || result === null) return null;

  const responseKeys: Record<EntityType, string> = {
    note: "note",
    capture: "capture",
    task: "task",
    project: "project",
    dailyNote: "dailyNote",
    tag: "tag",
  };

  const key = responseKeys[entityType];
  const entity = (result as Record<string, unknown>)[key];

  if (entity && typeof entity === "object") {
    return entity as Record<string, unknown>;
  }

  // Fallback: try the result itself
  if ("id" in (result as Record<string, unknown>)) {
    return result as Record<string, unknown>;
  }

  return null;
}

/**
 * Perform mutation on server with timeout
 * Times out after 5 seconds to allow quick fallback to offline mode
 */
async function performServerMutation(
  entityType: EntityType,
  operation: SyncOperation,
  id: string | undefined,
  payload: Record<string, unknown>
): Promise<unknown> {
  const endpoints: Record<EntityType, string> = {
    note: "/api/notes",
    capture: "/api/captures",
    task: "/api/tasks",
    project: "/api/projects",
    dailyNote: "/api/daily",
    tag: "/api/tags",
  };

  const endpoint = endpoints[entityType];

  // Create abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    let response: Response;
    const fetchOptions = { signal: controller.signal };

    switch (operation) {
      case "create":
        response = await fetch(endpoint, {
          ...fetchOptions,
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        break;
      case "update":
        response = await fetch(`${endpoint}/${id}`, {
          ...fetchOptions,
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        break;
      case "delete":
        response = await fetch(`${endpoint}/${id}`, {
          ...fetchOptions,
          method: "DELETE",
        });
        break;
    }

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`${operation} failed: ${response.status} - ${errorText}`);
    }

    return response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}
