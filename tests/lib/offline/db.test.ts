import { describe, it, expect, beforeEach, afterEach } from "vitest";
import "fake-indexeddb/auto";
import {
  offlineDb,
  isTempId,
  generateTempId,
  now,
  nowISO,
  type OfflineNote,
  type OfflineCapture,
  type OfflineTask,
  type OfflineProject,
} from "@/lib/offline/db";

describe("offline database helpers", () => {
  describe("isTempId", () => {
    it("returns true for temp IDs", () => {
      expect(isTempId("temp_abc123")).toBe(true);
      expect(isTempId("temp_")).toBe(true);
      expect(isTempId("temp_some-uuid-here")).toBe(true);
    });

    it("returns false for regular IDs", () => {
      expect(isTempId("abc123")).toBe(false);
      expect(isTempId("note-123")).toBe(false);
      expect(isTempId("")).toBe(false);
      expect(isTempId("temporary")).toBe(false);
    });
  });

  describe("generateTempId", () => {
    it("generates IDs starting with temp_", () => {
      const id = generateTempId();
      expect(id.startsWith("temp_")).toBe(true);
    });

    it("generates unique IDs", () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateTempId());
      }
      expect(ids.size).toBe(100);
    });
  });

  describe("now", () => {
    it("returns a number (Unix timestamp)", () => {
      const timestamp = now();
      expect(typeof timestamp).toBe("number");
      expect(timestamp).toBeGreaterThan(0);
    });

    it("returns current time", () => {
      const before = Date.now();
      const timestamp = now();
      const after = Date.now();
      expect(timestamp).toBeGreaterThanOrEqual(before);
      expect(timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe("nowISO", () => {
    it("returns an ISO date string", () => {
      const iso = nowISO();
      expect(typeof iso).toBe("string");
      expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it("can be parsed back to a valid date", () => {
      const iso = nowISO();
      const date = new Date(iso);
      expect(date.getTime()).not.toBeNaN();
    });
  });
});

describe("offline database operations", () => {
  beforeEach(async () => {
    // Clear all tables before each test
    await offlineDb.notes.clear();
    await offlineDb.captures.clear();
    await offlineDb.tasks.clear();
    await offlineDb.projects.clear();
    await offlineDb.dailyNotes.clear();
    await offlineDb.tags.clear();
    await offlineDb.syncQueue.clear();
    await offlineDb.syncMetadata.clear();
  });

  afterEach(async () => {
    // Clean up after tests
    await offlineDb.notes.clear();
    await offlineDb.captures.clear();
    await offlineDb.tasks.clear();
    await offlineDb.projects.clear();
    await offlineDb.syncQueue.clear();
  });

  describe("notes table", () => {
    it("can add and retrieve a note", async () => {
      const note: OfflineNote = {
        id: "note-1",
        user_id: "user-1",
        project_id: null,
        title: "Test Note",
        slug: "test-note",
        content: "# Test\n\nThis is content.",
        content_plain: "Test This is content.",
        note_type: "note",
        is_pinned: false,
        is_archived: false,
        word_count: 5,
        frontmatter: "{}",
        metadata: "{}",
        created_at: nowISO(),
        updated_at: nowISO(),
        _syncStatus: "synced",
        _lastModified: now(),
      };

      await offlineDb.notes.add(note);
      const retrieved = await offlineDb.notes.get("note-1");

      expect(retrieved).toBeDefined();
      expect(retrieved?.title).toBe("Test Note");
      expect(retrieved?.content).toBe("# Test\n\nThis is content.");
      expect(retrieved?._syncStatus).toBe("synced");
    });

    it("can update a note", async () => {
      const note: OfflineNote = {
        id: "note-2",
        user_id: "user-1",
        project_id: null,
        title: "Original Title",
        slug: "original-title",
        content: "Original content",
        content_plain: "Original content",
        note_type: "note",
        is_pinned: false,
        is_archived: false,
        word_count: 2,
        frontmatter: "{}",
        metadata: "{}",
        created_at: nowISO(),
        updated_at: nowISO(),
        _syncStatus: "synced",
        _lastModified: now(),
      };

      await offlineDb.notes.add(note);
      await offlineDb.notes.update("note-2", {
        title: "Updated Title",
        _syncStatus: "pending",
      });

      const updated = await offlineDb.notes.get("note-2");
      expect(updated?.title).toBe("Updated Title");
      expect(updated?._syncStatus).toBe("pending");
    });

    it("can delete a note", async () => {
      const note: OfflineNote = {
        id: "note-3",
        user_id: "user-1",
        project_id: null,
        title: "To Delete",
        slug: "to-delete",
        content: "",
        content_plain: "",
        note_type: "note",
        is_pinned: false,
        is_archived: false,
        word_count: 0,
        frontmatter: "{}",
        metadata: "{}",
        created_at: nowISO(),
        updated_at: nowISO(),
        _syncStatus: "synced",
        _lastModified: now(),
      };

      await offlineDb.notes.add(note);
      await offlineDb.notes.delete("note-3");

      const deleted = await offlineDb.notes.get("note-3");
      expect(deleted).toBeUndefined();
    });

    it("can query notes by sync status", async () => {
      const notes: OfflineNote[] = [
        {
          id: "note-a",
          user_id: "user-1",
          project_id: null,
          title: "Synced Note",
          slug: "synced-note",
          content: "",
          content_plain: "",
          note_type: "note",
          is_pinned: false,
          is_archived: false,
          word_count: 0,
          frontmatter: "{}",
          metadata: "{}",
          created_at: nowISO(),
          updated_at: nowISO(),
          _syncStatus: "synced",
          _lastModified: now(),
        },
        {
          id: "note-b",
          user_id: "user-1",
          project_id: null,
          title: "Pending Note",
          slug: "pending-note",
          content: "",
          content_plain: "",
          note_type: "note",
          is_pinned: false,
          is_archived: false,
          word_count: 0,
          frontmatter: "{}",
          metadata: "{}",
          created_at: nowISO(),
          updated_at: nowISO(),
          _syncStatus: "pending",
          _lastModified: now(),
        },
      ];

      await offlineDb.notes.bulkAdd(notes);

      const pending = await offlineDb.notes
        .where("_syncStatus")
        .equals("pending")
        .toArray();

      expect(pending.length).toBe(1);
      expect(pending[0].title).toBe("Pending Note");
    });
  });

  describe("captures table", () => {
    it("can add and retrieve a capture", async () => {
      const capture: OfflineCapture = {
        id: "capture-1",
        user_id: "user-1",
        daily_note_id: null,
        content: "Quick thought",
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
      };

      await offlineDb.captures.add(capture);
      const retrieved = await offlineDb.captures.get("capture-1");

      expect(retrieved).toBeDefined();
      expect(retrieved?.content).toBe("Quick thought");
      expect(retrieved?.capture_type).toBe("thought");
      expect(retrieved?.processed).toBe(false);
    });

    it("can query unprocessed captures", async () => {
      const captures: OfflineCapture[] = [
        {
          id: "cap-1",
          user_id: "user-1",
          daily_note_id: null,
          content: "Processed",
          capture_type: "idea",
          captured_at: nowISO(),
          processed: true,
          linked_notes: "[]",
          linked_projects: "[]",
          tags: "[]",
          metadata: "{}",
          created_at: nowISO(),
          _syncStatus: "synced",
          _lastModified: now(),
        },
        {
          id: "cap-2",
          user_id: "user-1",
          daily_note_id: null,
          content: "Unprocessed",
          capture_type: "thought",
          captured_at: nowISO(),
          processed: false,
          linked_notes: "[]",
          linked_projects: "[]",
          tags: "[]",
          metadata: "{}",
          created_at: nowISO(),
          _syncStatus: "synced",
          _lastModified: now(),
        },
      ];

      await offlineDb.captures.bulkAdd(captures);

      const unprocessed = await offlineDb.captures
        .filter((c) => c.processed === false)
        .toArray();

      expect(unprocessed.length).toBe(1);
      expect(unprocessed[0].content).toBe("Unprocessed");
    });
  });

  describe("tasks table", () => {
    it("can add and retrieve a task", async () => {
      const task: OfflineTask = {
        id: "task-1",
        user_id: "user-1",
        note_id: null,
        project_id: null,
        content: "Complete this task",
        status: "pending",
        priority: "high",
        due_date: null,
        completed_at: null,
        position: 0,
        tags: "[]",
        metadata: "{}",
        created_at: nowISO(),
        updated_at: nowISO(),
        _syncStatus: "synced",
        _lastModified: now(),
      };

      await offlineDb.tasks.add(task);
      const retrieved = await offlineDb.tasks.get("task-1");

      expect(retrieved).toBeDefined();
      expect(retrieved?.content).toBe("Complete this task");
      expect(retrieved?.status).toBe("pending");
      expect(retrieved?.priority).toBe("high");
    });

    it("can query tasks by status", async () => {
      const tasks: OfflineTask[] = [
        {
          id: "task-a",
          user_id: "user-1",
          note_id: null,
          project_id: null,
          content: "Pending task",
          status: "pending",
          priority: "medium",
          due_date: null,
          completed_at: null,
          position: 0,
          tags: "[]",
          metadata: "{}",
          created_at: nowISO(),
          updated_at: nowISO(),
          _syncStatus: "synced",
          _lastModified: now(),
        },
        {
          id: "task-b",
          user_id: "user-1",
          note_id: null,
          project_id: null,
          content: "Completed task",
          status: "completed",
          priority: "low",
          due_date: null,
          completed_at: nowISO(),
          position: 1,
          tags: "[]",
          metadata: "{}",
          created_at: nowISO(),
          updated_at: nowISO(),
          _syncStatus: "synced",
          _lastModified: now(),
        },
      ];

      await offlineDb.tasks.bulkAdd(tasks);

      const pending = await offlineDb.tasks
        .where("status")
        .equals("pending")
        .toArray();

      expect(pending.length).toBe(1);
      expect(pending[0].content).toBe("Pending task");
    });
  });

  describe("projects table", () => {
    it("can add and retrieve a project", async () => {
      const project: OfflineProject = {
        id: "project-1",
        user_id: "user-1",
        name: "My Project",
        slug: "my-project",
        description: "A test project",
        status: "active",
        color: "#6366f1",
        icon: "folder",
        priority: 0,
        parent_id: null,
        metadata: "{}",
        created_at: nowISO(),
        updated_at: nowISO(),
        _syncStatus: "synced",
        _lastModified: now(),
      };

      await offlineDb.projects.add(project);
      const retrieved = await offlineDb.projects.get("project-1");

      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe("My Project");
      expect(retrieved?.status).toBe("active");
    });
  });
});
