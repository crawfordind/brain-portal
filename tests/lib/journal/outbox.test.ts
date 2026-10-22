import { describe, it, expect, beforeEach } from "vitest";
import {
  __resetForTests,
  enqueue,
  getSnapshot,
  readDraft,
  remove,
  update,
  writeDraft,
} from "@/lib/journal/outbox";

describe("journal outbox", () => {
  beforeEach(() => {
    window.localStorage.clear();
    __resetForTests();
  });

  it("keeps an entry on the device until it is removed", () => {
    enqueue({ id: "entry-0001", date: "2026-10-22", text: "Hello" });
    __resetForTests(); // as if the page reloaded
    expect(getSnapshot()).toEqual([expect.objectContaining({ id: "entry-0001", text: "Hello" })]);

    remove("entry-0001");
    __resetForTests();
    expect(getSnapshot()).toEqual([]);
  });

  it("treats an entry still 'saving' after a reload as failed, so it is retried", () => {
    enqueue({ id: "entry-0002", date: "2026-10-22", text: "Hello" });
    __resetForTests();
    expect(getSnapshot()[0].status).toBe("failed");
  });

  it("does not queue the same id twice", () => {
    enqueue({ id: "entry-0003", date: "2026-10-22", text: "A" });
    enqueue({ id: "entry-0003", date: "2026-10-22", text: "A" });
    expect(getSnapshot()).toHaveLength(1);
  });

  it("records why a save failed", () => {
    enqueue({ id: "entry-0004", date: "2026-10-22", text: "A" });
    update("entry-0004", { status: "failed", error: "No connection", permanent: false });
    expect(getSnapshot()[0]).toMatchObject({ status: "failed", error: "No connection" });
  });

  it("survives unreadable storage", () => {
    window.localStorage.setItem("bp.journal.outbox.v1", "{not json");
    expect(getSnapshot()).toEqual([]);
  });

  it("keeps a draft per day", () => {
    writeDraft("2026-10-22", "half a thought");
    expect(readDraft("2026-10-22")).toBe("half a thought");
    expect(readDraft("2026-10-23")).toBe("");
    writeDraft("2026-10-22", "");
    expect(readDraft("2026-10-22")).toBe("");
  });
});
