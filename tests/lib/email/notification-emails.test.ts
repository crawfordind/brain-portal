import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildDailyDigestEmail, buildNotificationEmail } from "@/lib/notifications/emails";
import { taskQuickActions } from "@/lib/email/links";
import { verifyEmailActionToken } from "@/lib/email/action-tokens";

const saved: Record<string, string | undefined> = {};
const KEYS = ["APP_URL", "NEXT_PUBLIC_APP_URL", "VERCEL_ENV", "VERCEL_PROJECT_PRODUCTION_URL", "VERCEL_URL"];

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  // The production shape that produced localhost links: no NEXT_PUBLIC_APP_URL
  // at build time, only Vercel's own system variables at runtime.
  process.env.VERCEL_ENV = "production";
  process.env.VERCEL_PROJECT_PRODUCTION_URL = "brain.example.com";
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function tokenFrom(url: string) {
  return new URL(url).searchParams.get("token");
}

describe("overdue task email", () => {
  const build = () =>
    buildNotificationEmail({
      to: "me@example.com",
      userId: "user-1",
      userName: "Me",
      notification: {
        type: "task_overdue",
        title: "Overdue: <b>Pay</b> invoice",
        body: "Was due Tue, Sep 22 (2 days ago).",
        priority: "high",
        actionUrl: "/tasks?task=task-1",
      },
      actions: taskQuickActions("user-1", { id: "task-1", dueDate: "2026-09-22" }, "UTC"),
    });

  it("never links to localhost", () => {
    const email = build();
    expect(email.html).not.toContain("localhost");
    expect(email.text).not.toContain("localhost");
    expect(email.html).toContain("https://brain.example.com/tasks?task=task-1");
  });

  it("carries signed quick actions for this task and user", () => {
    const email = build();
    const actionUrls = [...email.html.matchAll(/href="(https:\/\/brain\.example\.com\/api\/email\/action\?token=[^"]+)"/g)].map((m) =>
      m[1].replace(/&amp;/g, "&")
    );
    const actions = actionUrls
      .map((u) => verifyEmailActionToken(tokenFrom(u)))
      .filter((r) => r.ok)
      .map((r) => (r.ok ? r.payload : null));
    expect(actions.map((a) => a?.a)).toEqual(expect.arrayContaining(["task_complete", "task_extend", "unsubscribe"]));
    expect(actions.every((a) => a?.u === "user-1")).toBe(true);
    expect(email.text).toContain("Mark done: https://brain.example.com/api/email/action?token=");
  });

  it("escapes user-authored content", () => {
    const email = build();
    expect(email.html).not.toContain("<b>Pay</b>");
    expect(email.html).toContain("&lt;b&gt;Pay&lt;/b&gt;");
  });

  it("offers one-click unsubscribe for the task category", () => {
    const email = build();
    expect(email.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    const url = email.headers?.["List-Unsubscribe"]?.slice(1, -1) ?? "";
    const result = verifyEmailActionToken(tokenFrom(url));
    expect(result.ok && result.payload).toMatchObject({ a: "unsubscribe", u: "user-1", p: { c: "tasks" } });
  });
});

describe("daily digest email", () => {
  it("gives each overdue task its own buttons and absolute links", () => {
    const email = buildDailyDigestEmail({
      to: "me@example.com",
      userId: "user-1",
      userName: "Me",
      timeZone: "America/New_York",
      date: "Thursday, September 24",
      stats: {
        tasksCompleted: 1,
        tasksOverdue: 1,
        tasksDueSoon: 0,
        notesCreated: 0,
        capturesCount: 0,
        aiTasksCompleted: 0,
        aiTasksAwaitingReview: 2,
        activeReminders: 0,
      },
      overdueTasks: [{ id: "task-9", title: "Call <script>alert(1)</script>", dueDate: "2026-09-20", priority: "urgent" }],
      dueSoonTasks: [],
      aiDigest: "Line one\n<img src=x onerror=alert(1)>",
      topInsights: [],
      streakInfo: null,
    });

    expect(email.html).toContain("https://brain.example.com/tasks?task=task-9");
    expect(email.html).toContain("https://brain.example.com/review");
    expect(email.html).not.toContain("<script>");
    expect(email.html).not.toContain("<img src=x");
    expect(email.html).not.toContain("localhost");
    expect(email.html.match(/api\/email\/action\?token=/g)!.length).toBeGreaterThanOrEqual(3);
  });
});
