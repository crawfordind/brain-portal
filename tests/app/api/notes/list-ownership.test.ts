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
    query.mockResolvedValue([
      { id: "n1", user_id: "viewer", slug: "mine", share_token: "own-token", _total_count: 2 },
      { id: "n2", user_id: "someone-else", slug: "theirs", share_token: "their-token", _total_count: 2 },
    ]);

    const res = await GET(new NextRequest("https://app.example.com/api/notes"));
    const { notes } = await res.json();

    expect(notes[0]).toMatchObject({ id: "n1", is_owner: true, share_token: "own-token" });
    expect(notes[1]).toMatchObject({ id: "n2", is_owner: false, share_token: null });
    expect(JSON.stringify(notes)).not.toContain("their-token");
    expect(notes[0]).not.toHaveProperty("_total_count");
  });
});
