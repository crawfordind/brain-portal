import { describe, it, expect, beforeEach, afterEach } from "vitest";
import "fake-indexeddb/auto";
import { offlineDb } from "@/lib/offline/db";
import {
  enqueueSync,
  getPendingItems,
  getPendingCount,
  markProcessing,
  markCompleted,
  markFailed,
  getFailedItems,
  retryFailed,
  clearQueue,
  getQueueStats,
} from "@/lib/offline/sync-queue";

describe("sync queue", () => {
  beforeEach(async () => {
    await offlineDb.syncQueue.clear();
  });

  afterEach(async () => {
    await offlineDb.syncQueue.clear();
  });

  describe("enqueueSync", () => {
    it("adds a new sync item to the queue", async () => {
      await enqueueSync("note", "note-1", "create", { title: "Test" });

      const items = await getPendingItems();
      expect(items.length).toBe(1);
      expect(items[0].entityType).toBe("note");
      expect(items[0].entityId).toBe("note-1");
      expect(items[0].operation).toBe("create");
      expect(items[0].payload).toEqual({ title: "Test" });
      expect(items[0].status).toBe("pending");
      expect(items[0].retryCount).toBe(0);
    });

    it("merges update operations on the same entity", async () => {
      await enqueueSync("note", "note-1", "update", { title: "First" });
      await enqueueSync("note", "note-1", "update", { content: "Second" });

      const items = await getPendingItems();
      expect(items.length).toBe(1);
      expect(items[0].payload).toEqual({ title: "First", content: "Second" });
    });

    it("keeps create operation when update follows", async () => {
      await enqueueSync("note", "note-1", "create", { title: "New Note" });
      await enqueueSync("note", "note-1", "update", { title: "Updated Note" });

      const items = await getPendingItems();
      expect(items.length).toBe(1);
      expect(items[0].operation).toBe("create");
      expect(items[0].payload).toEqual({ title: "Updated Note" });
    });

    it("delete supersedes update", async () => {
      await enqueueSync("note", "note-1", "update", { title: "Update" });
      await enqueueSync("note", "note-1", "delete", {});

      const items = await getPendingItems();
      expect(items.length).toBe(1);
      expect(items[0].operation).toBe("delete");
      expect(items[0].payload).toEqual({});
    });

    it("removes queue item when create then delete", async () => {
      await enqueueSync("note", "temp_123", "create", { title: "New" });
      await enqueueSync("note", "temp_123", "delete", {});

      const items = await getPendingItems();
      expect(items.length).toBe(0);
    });

    it("handles multiple different entities", async () => {
      await enqueueSync("note", "note-1", "create", { title: "Note 1" });
      await enqueueSync("capture", "capture-1", "create", { content: "Capture 1" });
      await enqueueSync("task", "task-1", "update", { status: "completed" });

      const items = await getPendingItems();
      expect(items.length).toBe(3);
    });
  });

  describe("getPendingItems", () => {
    it("returns items ordered by timestamp", async () => {
      await enqueueSync("note", "note-1", "create", { order: 1 });
      await new Promise((r) => setTimeout(r, 10)); // Small delay
      await enqueueSync("note", "note-2", "create", { order: 2 });
      await new Promise((r) => setTimeout(r, 10));
      await enqueueSync("note", "note-3", "create", { order: 3 });

      const items = await getPendingItems();
      expect(items.length).toBe(3);
      expect(items[0].entityId).toBe("note-1");
      expect(items[1].entityId).toBe("note-2");
      expect(items[2].entityId).toBe("note-3");
    });

    it("only returns pending items, not processing or failed", async () => {
      await enqueueSync("note", "note-1", "create", {});
      await enqueueSync("note", "note-2", "create", {});
      await enqueueSync("note", "note-3", "create", {});

      const items = await getPendingItems();
      const firstId = items[0].id!;
      const thirdId = items[2].id!;

      await markProcessing(firstId);
      await markFailed(thirdId, "Test error");
      await markFailed(thirdId, "Test error");
      await markFailed(thirdId, "Test error"); // 3 failures = permanent

      const pendingOnly = await getPendingItems();
      expect(pendingOnly.length).toBe(1);
      expect(pendingOnly[0].entityId).toBe("note-2");
    });
  });

  describe("getPendingCount", () => {
    it("returns correct count", async () => {
      expect(await getPendingCount()).toBe(0);

      await enqueueSync("note", "note-1", "create", {});
      expect(await getPendingCount()).toBe(1);

      await enqueueSync("note", "note-2", "create", {});
      expect(await getPendingCount()).toBe(2);

      await enqueueSync("capture", "cap-1", "create", {});
      expect(await getPendingCount()).toBe(3);
    });
  });

  describe("markProcessing", () => {
    it("changes status to processing", async () => {
      await enqueueSync("note", "note-1", "create", {});
      const items = await getPendingItems();
      const id = items[0].id!;

      await markProcessing(id);

      const item = await offlineDb.syncQueue.get(id);
      expect(item?.status).toBe("processing");
    });
  });

  describe("markCompleted", () => {
    it("removes item from queue", async () => {
      await enqueueSync("note", "note-1", "create", {});
      const items = await getPendingItems();
      const id = items[0].id!;

      await markCompleted(id);

      const item = await offlineDb.syncQueue.get(id);
      expect(item).toBeUndefined();
    });
  });

  describe("markFailed", () => {
    it("increments retry count and resets to pending", async () => {
      await enqueueSync("note", "note-1", "create", {});
      const items = await getPendingItems();
      const id = items[0].id!;

      await markFailed(id, "First error");

      const item = await offlineDb.syncQueue.get(id);
      expect(item?.status).toBe("pending");
      expect(item?.retryCount).toBe(1);
      expect(item?.lastError).toBe("First error");
    });

    it("marks as failed after 3 retries", async () => {
      await enqueueSync("note", "note-1", "create", {});
      const items = await getPendingItems();
      const id = items[0].id!;

      await markFailed(id, "Error 1");
      await markFailed(id, "Error 2");
      await markFailed(id, "Error 3");

      const item = await offlineDb.syncQueue.get(id);
      expect(item?.status).toBe("failed");
      expect(item?.retryCount).toBe(3);
    });
  });

  describe("getFailedItems", () => {
    it("returns only failed items", async () => {
      await enqueueSync("note", "note-1", "create", {});
      await enqueueSync("note", "note-2", "create", {});

      const items = await getPendingItems();
      const id = items[0].id!;

      // Fail 3 times
      await markFailed(id, "Error");
      await markFailed(id, "Error");
      await markFailed(id, "Error");

      const failed = await getFailedItems();
      expect(failed.length).toBe(1);
      expect(failed[0].entityId).toBe("note-1");
    });
  });

  describe("retryFailed", () => {
    it("resets failed items to pending with retry count 0", async () => {
      await enqueueSync("note", "note-1", "create", {});
      const items = await getPendingItems();
      const id = items[0].id!;

      // Fail 3 times
      await markFailed(id, "Error");
      await markFailed(id, "Error");
      await markFailed(id, "Error");

      const failedBefore = await getFailedItems();
      expect(failedBefore.length).toBe(1);

      const retried = await retryFailed();
      expect(retried).toBe(1);

      const failedAfter = await getFailedItems();
      expect(failedAfter.length).toBe(0);

      const pending = await getPendingItems();
      expect(pending.length).toBe(1);
      expect(pending[0].retryCount).toBe(0);
    });
  });

  describe("clearQueue", () => {
    it("removes all items from queue", async () => {
      await enqueueSync("note", "note-1", "create", {});
      await enqueueSync("note", "note-2", "update", {});
      await enqueueSync("capture", "cap-1", "delete", {});

      expect(await getPendingCount()).toBe(3);

      await clearQueue();

      expect(await getPendingCount()).toBe(0);
    });
  });

  describe("getQueueStats", () => {
    it("returns correct stats for different statuses", async () => {
      await enqueueSync("note", "note-1", "create", {});
      await enqueueSync("note", "note-2", "create", {});
      await enqueueSync("note", "note-3", "create", {});
      await enqueueSync("note", "note-4", "create", {});

      const items = await offlineDb.syncQueue.toArray();

      // Mark one as processing
      await markProcessing(items[0].id!);

      // Mark one as failed (3 times)
      await markFailed(items[1].id!, "Error");
      await markFailed(items[1].id!, "Error");
      await markFailed(items[1].id!, "Error");

      const stats = await getQueueStats();
      expect(stats.pending).toBe(2);
      expect(stats.processing).toBe(1);
      expect(stats.failed).toBe(1);
    });
  });
});
