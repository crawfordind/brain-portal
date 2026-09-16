import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "fake-indexeddb/auto";
import { offlineDb, nowISO, now } from "@/lib/offline/db";
import { enqueueSync, getPendingCount, getFailedItems } from "@/lib/offline/sync-queue";
import { SyncManager } from "@/lib/offline/sync-manager";

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock navigator.onLine
Object.defineProperty(navigator, "onLine", {
  value: true,
  writable: true,
});

describe("SyncManager", () => {
  let syncManager: SyncManager;
  let statusCallback: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    // Clear all tables
    await offlineDb.notes.clear();
    await offlineDb.captures.clear();
    await offlineDb.tasks.clear();
    await offlineDb.projects.clear();
    await offlineDb.syncQueue.clear();
    await offlineDb.syncMetadata.clear();

    // Reset mocks
    vi.clearAllMocks();
    mockFetch.mockReset();

    // Create sync manager with status callback
    statusCallback = vi.fn();
    syncManager = new SyncManager(statusCallback as unknown as (status: { state: string; pending: number; lastSync?: number }) => void);
  });

  afterEach(async () => {
    await offlineDb.notes.clear();
    await offlineDb.captures.clear();
    await offlineDb.tasks.clear();
    await offlineDb.projects.clear();
    await offlineDb.syncQueue.clear();
    await offlineDb.syncMetadata.clear();
  });

  describe("sync", () => {
    it("returns early when offline", async () => {
      Object.defineProperty(navigator, "onLine", { value: false });

      const result = await syncManager.sync();

      expect(result.success).toBe(false);
      expect(result.errors).toContain("Offline");
      expect(mockFetch).not.toHaveBeenCalled();

      // Restore online status
      Object.defineProperty(navigator, "onLine", { value: true });
    });

    it("processes pending create operations", async () => {
      // Add a pending capture to the queue
      await offlineDb.captures.add({
        id: "temp_123",
        user_id: "user-1",
        daily_note_id: null,
        content: "Test capture",
        capture_type: "thought",
        captured_at: nowISO(),
        processed: false,
        linked_notes: "[]",
        linked_projects: "[]",
        tags: "[]",
        metadata: "{}",
        created_at: nowISO(),
        _syncStatus: "pending",
        _lastModified: now(),
      });

      await enqueueSync("capture", "temp_123", "create", {
        content: "Test capture",
        captureType: "thought",
      });

      // Mock successful API response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          capture: {
            id: "server-capture-1",
            user_id: "user-1",
            content: "Test capture",
            capture_type: "thought",
            captured_at: nowISO(),
            processed: false,
            linked_notes: "[]",
            linked_projects: "[]",
            tags: "[]",
            metadata: "{}",
            created_at: nowISO(),
          },
        }),
      });

      // Mock the pull data responses (empty)
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ notes: [], captures: [], tasks: [], projects: [] }),
      });

      const result = await syncManager.sync();

      expect(result.success).toBe(true);
      expect(result.syncedCount).toBe(1);
      expect(result.failedCount).toBe(0);

      // Verify the create API was called
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/captures",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            content: "Test capture",
            captureType: "thought",
          }),
        })
      );

      // Verify queue is empty
      expect(await getPendingCount()).toBe(0);
    });

    it("processes pending update operations", async () => {
      // Add a note to the local DB
      await offlineDb.notes.add({
        id: "note-1",
        user_id: "user-1",
        project_id: null,
        title: "Updated Title",
        slug: "updated-title",
        content: "Updated content",
        content_plain: "Updated content",
        note_type: "note",
        is_pinned: false,
        is_archived: false,
        word_count: 2,
        frontmatter: "{}",
        metadata: "{}",
        created_at: nowISO(),
        updated_at: nowISO(),
        _syncStatus: "pending",
        _lastModified: now(),
      });

      await enqueueSync("note", "note-1", "update", {
        title: "Updated Title",
        content: "Updated content",
      });

      // Mock successful API response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          note: {
            id: "note-1",
            title: "Updated Title",
            content: "Updated content",
          },
        }),
      });

      // Mock pull responses
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ notes: [], captures: [], tasks: [], projects: [] }),
      });

      const result = await syncManager.sync();

      expect(result.success).toBe(true);
      expect(result.syncedCount).toBe(1);

      // Verify the update API was called
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/notes/note-1",
        expect.objectContaining({
          method: "PUT",
        })
      );
    });

    it("processes pending delete operations", async () => {
      await enqueueSync("task", "task-1", "delete", {});

      // Mock successful API response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      // Mock pull responses
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ notes: [], captures: [], tasks: [], projects: [] }),
      });

      const result = await syncManager.sync();

      expect(result.success).toBe(true);
      expect(result.syncedCount).toBe(1);

      // Verify the delete API was called
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/tasks/task-1",
        expect.objectContaining({
          method: "DELETE",
        })
      );
    });

    it("handles API errors and marks items as failed", async () => {
      await enqueueSync("note", "note-1", "create", { title: "Test" });

      // Mock failed API response
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      });

      // Mock pull responses
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ notes: [], captures: [], tasks: [], projects: [] }),
      });

      const result = await syncManager.sync();

      expect(result.success).toBe(true); // Overall sync still succeeds
      expect(result.syncedCount).toBe(0);
      expect(result.failedCount).toBe(1);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0]).toContain("note/note-1");
    });

    it("calls status callback during sync", async () => {
      await enqueueSync("capture", "cap-1", "create", { content: "Test" });

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ capture: { id: "cap-1" }, notes: [], captures: [], tasks: [], projects: [] }),
      });

      await syncManager.sync();

      // Should have been called with syncing status
      expect(statusCallback).toHaveBeenCalledWith(
        expect.objectContaining({ state: "syncing" })
      );

      // Should have been called with final status
      expect(statusCallback).toHaveBeenCalledWith(
        expect.objectContaining({ state: expect.stringMatching(/synced|pending/) })
      );
    });

    it("handles multiple items in queue", async () => {
      await enqueueSync("note", "note-1", "create", { title: "Note 1" });
      await enqueueSync("capture", "cap-1", "create", { content: "Capture 1" });
      await enqueueSync("task", "task-1", "create", { content: "Task 1" });

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          note: { id: "note-1" },
          capture: { id: "cap-1" },
          task: { id: "task-1" },
          notes: [],
          captures: [],
          tasks: [],
          projects: [],
        }),
      });

      const result = await syncManager.sync();

      expect(result.syncedCount).toBe(3);
      expect(await getPendingCount()).toBe(0);
    });
  });

  describe("pullLatestData", () => {
    it("fetches data from all entity endpoints", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ notes: [], captures: [], tasks: [], projects: [] }),
      });

      await syncManager.pullLatestData();

      // Should call all 4 entity endpoints. Each request now carries an abort
      // signal for its timeout, so assert on the URL and accept the options
      // object rather than pinning the exact argument list.
      const urls = mockFetch.mock.calls.map(([url]) => url);
      expect(urls).toContain("/api/notes?limit=1000");
      expect(urls).toContain("/api/captures?limit=1000");
      expect(urls).toContain("/api/tasks?includeCompleted=true");
      expect(urls).toContain("/api/projects?includeArchived=true");
    });

    it("stores fetched data in IndexedDB", async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url.includes("/api/notes")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              notes: [
                {
                  id: "note-1",
                  user_id: "user-1",
                  title: "Server Note",
                  slug: "server-note",
                  content: "Content",
                  content_plain: "Content",
                  note_type: "note",
                  is_pinned: false,
                  is_archived: false,
                  word_count: 1,
                  frontmatter: "{}",
                  metadata: "{}",
                  created_at: nowISO(),
                  updated_at: nowISO(),
                },
              ],
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ captures: [], tasks: [], projects: [] }),
        });
      });

      await syncManager.pullLatestData();

      const note = await offlineDb.notes.get("note-1");
      expect(note).toBeDefined();
      expect(note?.title).toBe("Server Note");
      expect(note?._syncStatus).toBe("synced");
    });

    it("preserves local pending changes (last-write-wins)", async () => {
      // Add local note with pending changes
      await offlineDb.notes.add({
        id: "note-1",
        user_id: "user-1",
        project_id: null,
        title: "Local Title",
        slug: "local-title",
        content: "Local content",
        content_plain: "Local content",
        note_type: "note",
        is_pinned: false,
        is_archived: false,
        word_count: 2,
        frontmatter: "{}",
        metadata: "{}",
        created_at: nowISO(),
        updated_at: nowISO(),
        _syncStatus: "pending", // Local has pending changes
        _lastModified: now(),
      });

      mockFetch.mockImplementation((url: string) => {
        if (url.includes("/api/notes")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              notes: [
                {
                  id: "note-1",
                  title: "Server Title", // Different from local
                  slug: "server-title",
                  content: "Server content",
                },
              ],
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ captures: [], tasks: [], projects: [] }),
        });
      });

      await syncManager.pullLatestData();

      // Local pending changes should be preserved
      const note = await offlineDb.notes.get("note-1");
      expect(note?.title).toBe("Local Title");
      expect(note?._syncStatus).toBe("pending");
    });

    it("handles fetch errors gracefully", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      // Should not throw
      await expect(syncManager.pullLatestData()).resolves.not.toThrow();
    });
  });

  describe("syncing property", () => {
    it("returns false initially", () => {
      expect(syncManager.syncing).toBe(false);
    });
  });
});
