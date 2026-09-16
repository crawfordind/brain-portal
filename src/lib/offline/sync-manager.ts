import {
  offlineDb,
  EntityType,
  SyncQueueItem,
  isTempId,
  now,
} from "./db";
import {
  getPendingItems,
  markProcessing,
  markCompleted,
  markFailed,
  getPendingCount,
} from "./sync-queue";

// API endpoints for each entity type
const API_ENDPOINTS: Record<EntityType, string> = {
  note: "/api/notes",
  capture: "/api/captures",
  task: "/api/tasks",
  project: "/api/projects",
  dailyNote: "/api/daily",
  tag: "/api/tags",
};

// Response keys for each entity type
const RESPONSE_KEYS: Record<EntityType, string> = {
  note: "note",
  capture: "capture",
  task: "task",
  project: "project",
  dailyNote: "dailyNote",
  tag: "tag",
};

// List response keys for each entity type
const LIST_RESPONSE_KEYS: Record<EntityType, string> = {
  note: "notes",
  capture: "captures",
  task: "tasks",
  project: "projects",
  dailyNote: "dailyNotes",
  tag: "tags",
};

export interface SyncResult {
  success: boolean;
  syncedCount: number;
  failedCount: number;
  errors: string[];
}

export interface SyncStatus {
  state: "synced" | "syncing" | "pending" | "error" | "offline";
  pending: number;
  lastSync?: number;
}

export type SyncStatusCallback = (status: SyncStatus) => void;

/**
 * SyncManager handles bidirectional sync between IndexedDB and the server
 */
export class SyncManager {
  private isSyncing = false;
  private onStatusChange?: SyncStatusCallback;

  constructor(onStatusChange?: SyncStatusCallback) {
    this.onStatusChange = onStatusChange;
  }

  /**
   * Push local changes to server, then pull latest data
   */
  async sync(): Promise<SyncResult> {
    if (this.isSyncing) {
      return { success: true, syncedCount: 0, failedCount: 0, errors: [] };
    }

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      return { success: false, syncedCount: 0, failedCount: 0, errors: ["Offline"] };
    }

    this.isSyncing = true;
    this.onStatusChange?.({ state: "syncing", pending: 0 });

    const result: SyncResult = {
      success: true,
      syncedCount: 0,
      failedCount: 0,
      errors: [],
    };

    try {
      // Push local changes to server
      const pendingItems = await getPendingItems();

      for (const item of pendingItems) {
        await markProcessing(item.id!);

        try {
          await this.processSyncItem(item);
          await markCompleted(item.id!);
          result.syncedCount++;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Unknown error";
          await markFailed(item.id!, errorMessage);
          result.failedCount++;
          result.errors.push(`${item.entityType}/${item.entityId}: ${errorMessage}`);
        }
      }

      // Pull latest from server
      await this.pullLatestData();

      // Update sync metadata
      await offlineDb.syncMetadata.put({
        id: "global",
        lastFullSync: now(),
        lastIncrementalSync: now(),
        syncInProgress: false,
      });
    } catch (error) {
      result.success = false;
      result.errors.push(error instanceof Error ? error.message : "Sync failed");
    } finally {
      this.isSyncing = false;
      const pending = await getPendingCount();
      this.onStatusChange?.({
        state: pending > 0 ? "pending" : "synced",
        pending,
        lastSync: now(),
      });
    }

    return result;
  }

  /**
   * Process a single sync queue item
   */
  private async processSyncItem(item: SyncQueueItem): Promise<void> {
    const endpoint = API_ENDPOINTS[item.entityType];

    switch (item.operation) {
      case "create": {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(item.payload),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Create failed: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        const serverEntity = data[RESPONSE_KEYS[item.entityType]] || data;

        // Update local record with server ID (replace temp ID)
        await this.updateLocalWithServerId(item.entityType, item.entityId, serverEntity);
        break;
      }

      case "update": {
        // Skip update if it's a temp ID that hasn't been synced yet
        if (isTempId(item.entityId)) {
          throw new Error("Cannot update unsynchronized record");
        }

        const response = await fetch(`${endpoint}/${item.entityId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(item.payload),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Update failed: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        await this.updateLocalRecord(item.entityType, item.entityId, data);
        break;
      }

      case "delete": {
        // Skip delete if it's a temp ID (never existed on server)
        if (isTempId(item.entityId)) {
          return;
        }

        const response = await fetch(`${endpoint}/${item.entityId}`, {
          method: "DELETE",
        });

        // 404 is acceptable - item might already be deleted
        if (!response.ok && response.status !== 404) {
          const errorText = await response.text();
          throw new Error(`Delete failed: ${response.status} - ${errorText}`);
        }
        break;
      }
    }
  }

  /**
   * Replace temp ID with server ID after successful create
   */
  private async updateLocalWithServerId(
    entityType: EntityType,
    tempId: string,
    serverEntity: Record<string, unknown>
  ): Promise<void> {
    const table = this.getTable(entityType);

    // Delete the temp record
    await table.delete(tempId);

    // Add the server record with synced status
    await table.put({
      ...serverEntity,
      _syncStatus: "synced",
      _lastModified: now(),
    } as never);
  }

  /**
   * Update local record after successful update
   */
  private async updateLocalRecord(
    entityType: EntityType,
    entityId: string,
    data: Record<string, unknown>
  ): Promise<void> {
    const table = this.getTable(entityType);
    const serverEntity = data[RESPONSE_KEYS[entityType]] || data;

    await table.update(entityId, {
      ...serverEntity,
      _syncStatus: "synced",
      _lastModified: now(),
    } as never);
  }

  /**
   * Get the Dexie table for an entity type
   */
  private getTable(entityType: EntityType) {
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
   * Pull latest data from server for all entity types.
   * Uses parallel requests with individual error handling so
   * one failed pull doesn't block the others.
   */
  async pullLatestData(): Promise<void> {
    if (typeof navigator !== "undefined" && !navigator.onLine) return;

    await Promise.allSettled([
      this.pullEntity("note", "/api/notes?limit=1000"),
      this.pullEntity("capture", "/api/captures?limit=1000"),
      this.pullEntity("task", "/api/tasks?includeCompleted=true"),
      this.pullEntity("project", "/api/projects?includeArchived=true"),
      this.pullEntity("tag", "/api/tags"),
    ]);
  }

  /**
   * Pull a single entity type from server
   */
  private async pullEntity(entityType: EntityType, endpoint: string): Promise<void> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(endpoint, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) return;

      const data = await response.json();
      const entities = data[LIST_RESPONSE_KEYS[entityType]] || [];
      const table = this.getTable(entityType);

      // Batch upserts for better performance
      await offlineDb.transaction("rw", table, async () => {
        for (const entity of entities) {
          const existing = await table.get(entity.id);

          // Last-write-wins: server wins if local is synced or doesn't exist
          if (!existing || existing._syncStatus === "synced") {
            await table.put({
              ...entity,
              _syncStatus: "synced",
              _lastModified: now(),
            } as never);
          }
          // If local has pending changes, keep local version
        }
      });

      // Clean up local records that no longer exist on server
      // (only for synced records - never delete pending local changes)
      const serverIds = new Set(entities.map((e: { id: string }) => e.id));
      const localRecords = await table.toArray();
      for (const local of localRecords) {
        if (local._syncStatus === "synced" && !serverIds.has(local.id)) {
          await table.delete(local.id);
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        console.warn(`Pull ${entityType} timed out`);
      } else {
        console.warn(`Failed to pull ${entityType}:`, error);
      }
    }
  }

  /**
   * Check if currently syncing
   */
  get syncing(): boolean {
    return this.isSyncing;
  }
}

// Singleton instance
let syncManagerInstance: SyncManager | null = null;

export function getSyncManager(onStatusChange?: SyncStatusCallback): SyncManager {
  if (!syncManagerInstance) {
    syncManagerInstance = new SyncManager(onStatusChange);
  } else if (onStatusChange) {
    // Update callback if provided
    syncManagerInstance = new SyncManager(onStatusChange);
  }
  return syncManagerInstance;
}
