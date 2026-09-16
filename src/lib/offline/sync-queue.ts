import { offlineDb, SyncQueueItem, EntityType, SyncOperation } from "./db";

/**
 * Enqueue a sync operation for later processing
 * Handles deduplication and operation merging
 */
export async function enqueueSync(
  entityType: EntityType,
  entityId: string,
  operation: SyncOperation,
  payload: Record<string, unknown>
): Promise<void> {
  // Check for existing pending operation on same entity
  const existing = await offlineDb.syncQueue
    .where({ entityType, entityId, status: "pending" })
    .first();

  if (existing) {
    // Merge operations intelligently
    if (operation === "delete") {
      // Delete supersedes everything - if we're deleting, just update to delete
      if (existing.operation === "create") {
        // Created then deleted offline = never existed on server, just remove from queue
        await offlineDb.syncQueue.delete(existing.id!);
      } else {
        await offlineDb.syncQueue.update(existing.id!, {
          operation: "delete",
          payload: {},
          timestamp: Date.now(),
        });
      }
    } else if (operation === "update") {
      if (existing.operation === "create") {
        // Created then updated offline = still a create with merged data
        await offlineDb.syncQueue.update(existing.id!, {
          payload: { ...existing.payload, ...payload },
          timestamp: Date.now(),
        });
      } else if (existing.operation === "update") {
        // Multiple updates = merge the payloads
        await offlineDb.syncQueue.update(existing.id!, {
          payload: { ...existing.payload, ...payload },
          timestamp: Date.now(),
        });
      }
      // If existing is 'delete', ignore the update (can't update deleted item)
    }
    // If new operation is 'create' and something already exists, ignore (shouldn't happen)
  } else {
    // No existing operation, add new one
    await offlineDb.syncQueue.add({
      entityType,
      entityId,
      operation,
      payload,
      timestamp: Date.now(),
      retryCount: 0,
      status: "pending",
    });
  }
}

/**
 * Get all pending sync items, ordered by timestamp
 */
export async function getPendingItems(): Promise<SyncQueueItem[]> {
  return offlineDb.syncQueue
    .where("status")
    .equals("pending")
    .sortBy("timestamp");
}

/**
 * Get count of pending items
 */
export async function getPendingCount(): Promise<number> {
  return offlineDb.syncQueue.where("status").equals("pending").count();
}

/**
 * Mark an item as being processed
 */
export async function markProcessing(id: number): Promise<void> {
  await offlineDb.syncQueue.update(id, { status: "processing" });
}

/**
 * Mark an item as successfully synced (removes from queue)
 */
export async function markCompleted(id: number): Promise<void> {
  await offlineDb.syncQueue.delete(id);
}

/**
 * Mark an item as failed, with retry logic
 */
export async function markFailed(id: number, error: string): Promise<void> {
  const item = await offlineDb.syncQueue.get(id);
  if (!item) return;

  const newRetryCount = item.retryCount + 1;
  const MAX_RETRIES = 3;

  if (newRetryCount >= MAX_RETRIES) {
    // Max retries reached, mark as failed permanently
    await offlineDb.syncQueue.update(id, {
      status: "failed",
      lastError: error,
      retryCount: newRetryCount,
    });
  } else {
    // Reset to pending for retry
    await offlineDb.syncQueue.update(id, {
      status: "pending",
      lastError: error,
      retryCount: newRetryCount,
    });
  }
}

/**
 * Get all permanently failed items
 */
export async function getFailedItems(): Promise<SyncQueueItem[]> {
  return offlineDb.syncQueue.where("status").equals("failed").toArray();
}

/**
 * Retry all failed items
 */
export async function retryFailed(): Promise<number> {
  const failed = await getFailedItems();
  for (const item of failed) {
    await offlineDb.syncQueue.update(item.id!, {
      status: "pending",
      retryCount: 0,
      lastError: undefined,
    });
  }
  return failed.length;
}

/**
 * Clear all completed items (cleanup)
 */
export async function clearCompleted(): Promise<void> {
  // Note: markCompleted already deletes, but this is for safety
  await offlineDb.syncQueue.where("status").equals("completed").delete();
}

/**
 * Clear entire sync queue (use with caution)
 */
export async function clearQueue(): Promise<void> {
  await offlineDb.syncQueue.clear();
}

/**
 * Get queue statistics
 */
export async function getQueueStats(): Promise<{
  pending: number;
  processing: number;
  failed: number;
}> {
  const [pending, processing, failed] = await Promise.all([
    offlineDb.syncQueue.where("status").equals("pending").count(),
    offlineDb.syncQueue.where("status").equals("processing").count(),
    offlineDb.syncQueue.where("status").equals("failed").count(),
  ]);
  return { pending, processing, failed };
}
