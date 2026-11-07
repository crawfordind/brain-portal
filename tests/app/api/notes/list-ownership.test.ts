/**
 * `GET /api/notes` lists the viewer's own notes plus notes in projects shared
 * with them. Only the first kind may be shared onward, and the second must
 * never carry its owner's public-link token.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const query = vi.fn();

vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn(() => Promise.resolve({ id: "viewer", email: "owner@example.com" })) }));
vi.mock("@/lib/db/client", async () => ({
  ...(await import("../../../helpers/db-mock")).createDbClientMock(),
  query: (...args: unknown[]) => query(...args),
}));

import { GET } from "@/app/api/notes/route";

describe("GET /api/notes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("marks the viewer's own notes and strips a collaborator's public-link token", async () => {
    mockQueries();

    const res = await GET(new NextRequest("https://app.example.com/api/notes"));
    const { notes, total, hasMore } = await res.json();

    expect(notes[0]).toMatchObject({ id: "n1", is_owner: true, share_token: "own-token" });
    expect(notes[1]).toMatchObject({ id: "n2", is_owner: false, share_token: null });
    expect(JSON.stringify(notes)).not.toContain("their-token");
    expect(total).toBe(2);
    expect(hasMore).toBe(false);
  });

  it("keeps the page order chosen by the id query", async () => {
    mockQueries();
    const res = await GET(new NextRequest("https://app.example.com/api/notes"));
    const { notes } = await res.json();
    expect(notes.map((n: { id: string }) => n.id)).toEqual(["n1", "n2"]);
  });

  // A window over full rows made SQLite hold every matching note body in
  // memory before LIMIT, and took the database down with SQLITE_NOMEM.
  it("never sorts or windows over full note rows", async () => {
    mockQueries();
    await GET(new NextRequest("https://app.example.com/api/notes?search=plan"));
    for (const [sql] of query.mock.calls as [string][]) {
      expect(sql).not.toMatch(/OVER\s*\(/i);
      if (/n\.\*/.test(sql)) {
        expect(sql).not.toMatch(/ORDER BY/i);
        expect(sql).toMatch(/n\.id IN \(/);
      }
    }
  });
});

function mockQueries() {
  query.mockImplementation((sql: string) => {
    if (/^\s*SELECT n\.id\s+FROM/i.test(sql)) return Promise.resolve([{ id: "n1" }, { id: "n2" }]);
    if (/COUNT\(\*\) as total/.test(sql)) return Promise.resolve([{ total: 2 }]);
    if (/n\.\*/.test(sql)) {
      // Returned out of order on purpose: the route must restore page order.
      return Promise.resolve([
        { id: "n2", user_id: "someone-else", slug: "theirs", share_token: "their-token" },
        { id: "n1", user_id: "viewer", slug: "mine", share_token: "own-token" },
      ]);
    }
    return Promise.resolve([]);
  });
}
