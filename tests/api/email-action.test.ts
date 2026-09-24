import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/db/client", async () => (await import("../helpers/db-mock")).createDbClientMock());

import { db, queryOne } from "@/lib/db/client";
import { GET, POST } from "@/app/api/email/action/route";
import { createEmailActionToken } from "@/lib/email/action-tokens";

const TASK = {
  id: "task-1",
  user_id: "user-1",
  title: "Pay invoice",
  content: "Pay invoice",
  status: "pending",
  due_date: "2026-09-01",
  recurrence_rule: null,
  recurrence_end_date: null,
  priority: "high",
  project_id: null,
  note_id: null,
  tags: "[]",
};

const execute = db.execute as unknown as ReturnType<typeof vi.fn>;
const one = queryOne as unknown as ReturnType<typeof vi.fn>;

function req(method: "GET" | "POST", token: string | null, body?: Record<string, string>) {
  const url = `https://brain.example.com/api/email/action${token ? `?token=${encodeURIComponent(token)}` : ""}`;
  return new NextRequest(url, {
    method,
    headers: body ? { "content-type": "application/x-www-form-urlencoded" } : undefined,
    body: body ? new URLSearchParams(body).toString() : undefined,
  });
}

beforeEach(() => {
  execute.mockReset().mockResolvedValue({ rows: [], rowsAffected: 1 });
  one.mockReset().mockImplementation(async (sql: string) => {
    if (sql.includes("FROM tasks")) return { ...TASK };
    if (sql.includes("notification_preferences")) return { timezone: "UTC" };
    return null;
  });
});

describe("GET /api/email/action", () => {
  it("renders a confirmation and changes nothing", async () => {
    const token = createEmailActionToken({ u: "user-1", a: "task_complete", id: "task-1" })!;
    const res = await GET(req("GET", token));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Mark this task done?");
    expect(html).toContain("Pay invoice");
    expect(html).toContain('method="post"');
    expect(execute).not.toHaveBeenCalled();
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("explains an invalid link instead of erroring", async () => {
    const res = await GET(req("GET", "v1.bogus.sig"));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("This link isn");
  });
});

describe("POST /api/email/action", () => {
  it("completes the task, scoped to the token's user, and offers undo", async () => {
    const token = createEmailActionToken({ u: "user-1", a: "task_complete", id: "task-1" })!;
    const res = await POST(req("POST", null, { token }));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Marked done.");
    expect(html).toContain("Undo");

    const update = execute.mock.calls.find(([q]) => String(q.sql).includes("SET status = 'completed'"));
    expect(update).toBeDefined();
    expect(update![0].args).toEqual(["task-1", "user-1"]);
    expect(update![0].sql).toContain("status != 'completed'");
  });

  it("extends to the date signed into the link, and only once", async () => {
    const token = createEmailActionToken({
      u: "user-1",
      a: "task_extend",
      id: "task-1",
      p: { days: 1, due: "2099-01-02" },
    })!;
    await POST(req("POST", null, { token }));
    const update = execute.mock.calls.find(([q]) => String(q.sql).includes("SET due_date"));
    expect(update![0].args).toEqual(["2099-01-02", "task-1", "user-1"]);

    // A repeat (double tap, link scanner) sees the date already moved.
    execute.mockClear();
    one.mockImplementation(async (sql: string) =>
      sql.includes("FROM tasks") ? { ...TASK, due_date: "2099-01-02" } : { timezone: "UTC" }
    );
    const again = await POST(req("POST", null, { token }));
    expect(await again.text()).toContain("already moved");
    expect(execute).not.toHaveBeenCalled();
  });

  it("supports RFC 8058 one-click unsubscribe", async () => {
    const token = createEmailActionToken({ u: "user-1", a: "unsubscribe", p: { c: "tasks" } })!;
    const res = await POST(req("POST", token, { "List-Unsubscribe": "One-Click" }));
    expect(res.status).toBe(200);
    const update = execute.mock.calls.find(([q]) => String(q.sql).includes("email_overdue_tasks = 0"));
    expect(update![0].args).toEqual(["user-1"]);
  });

  it("refuses to let one-click run anything but an unsubscribe", async () => {
    const token = createEmailActionToken({ u: "user-1", a: "task_complete", id: "task-1" })!;
    const res = await POST(req("POST", token, { "List-Unsubscribe": "One-Click" }));
    expect(res.status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });

  it("reports a deleted task without writing", async () => {
    one.mockResolvedValue(null);
    const token = createEmailActionToken({ u: "user-1", a: "task_complete", id: "gone" })!;
    const res = await POST(req("POST", null, { token }));
    expect(res.status).toBe(404);
    expect(execute).not.toHaveBeenCalled();
  });
});
