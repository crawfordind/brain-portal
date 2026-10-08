import { describe, it, expect } from "vitest";
import { dateLabel, timeAgo } from "@/lib/operations/format";
import { judgeQueue, judgeRule } from "@/lib/operations/automations";

describe("dateLabel", () => {
  it("labels by calendar day", () => {
    expect(dateLabel("2026-10-05", "2026-10-08")).toEqual({ text: "3d overdue", tone: "late" });
    expect(dateLabel("2026-10-08", "2026-10-08")?.text).toBe("Today");
    expect(dateLabel("2026-10-09", "2026-10-08")?.text).toBe("Tomorrow");
    expect(dateLabel("2026-10-30", "2026-10-08")?.text).toBe("Oct 30");
    expect(dateLabel(null, "2026-10-08")).toBeNull();
  });
});

describe("timeAgo", () => {
  it("reads zone-less SQLite timestamps as UTC", () => {
    const now = Date.parse("2026-10-08T12:00:00Z");
    expect(timeAgo("2026-10-08 10:00:00", now)).toBe("2h ago");
  });
});

describe("judgeQueue", () => {
  const base = { lastSuccessAt: "x", lastRunAt: "x", failures: 0, stalledCount: 0, stalledSince: null };

  it("is quiet when healthy", () => {
    expect(judgeQueue(base, "jobs")).toEqual({ status: "healthy", signal: "" });
  });

  it("treats a stall as failing even with no error rows", () => {
    expect(judgeQueue({ ...base, stalledCount: 4 }, "jobs").status).toBe("failing");
  });

  it("separates a blip from repeated failure", () => {
    expect(judgeQueue({ ...base, failures: 1 }, "jobs").status).toBe("degraded");
    expect(judgeQueue({ ...base, failures: 5 }, "jobs").status).toBe("failing");
  });

  it("never reports health without evidence", () => {
    expect(judgeQueue({ ...base, lastRunAt: null, lastSuccessAt: null }, "jobs").status).toBe("unknown");
  });
});

describe("judgeRule", () => {
  it("reports paused, failing and degraded rules plainly", () => {
    const base = { enabled: true, lastRunAt: "x", lastStatus: "ok", lastError: null, recentErrors: 0 };
    expect(judgeRule({ ...base, enabled: false }).status).toBe("paused");
    expect(judgeRule({ ...base, recentErrors: 3, lastError: "boom" })).toEqual({
      status: "failing",
      signal: "Failing repeatedly: boom",
    });
    expect(judgeRule({ ...base, lastStatus: "error" }).status).toBe("degraded");
    expect(judgeRule(base).status).toBe("healthy");
  });
});
