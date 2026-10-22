import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/auth");
vi.mock("@/lib/db/client", async () => (await import("../../../helpers/db-mock")).createDbClientMock());
vi.mock("@/lib/ai/embeddings", () => ({ findSimilarToText: vi.fn().mockResolvedValue([]) }));

import { GET } from "@/app/api/search/route";
import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { queryAll } from "@/lib/db/client";
import { HIGHLIGHT_END as E, HIGHLIGHT_START as S } from "@/lib/search/snippet";

const user = { id: "user-1", email: "owner@example.com" };

function search(q: string, type = "all") {
  return GET(new NextRequest(`http://localhost/api/search?q=${encodeURIComponent(q)}&type=${type}`));
}

describe("GET /api/search", () => {
  beforeEach(() => {
    vi.mocked(getCurrentUser).mockResolvedValue(user as never);
    vi.mocked(queryAll).mockReset().mockResolvedValue([]);
  });

  it("never returns stored HTML in a note's content or snippet", async () => {
    vi.mocked(queryAll).mockResolvedValueOnce([
      {
        id: "n1",
        type: "note",
        title: "Launch",
        body: "<h2>Launch</h2><p>Ship the <strong>budget</strong> &amp; plan</p>",
        fts_snippet: null,
        slug: "launch",
        created_at: "2026-10-01 10:00:00",
        updated_at: "2026-10-01 10:00:00",
        rank: -1,
      },
    ]);

    const body = await (await search("budget", "note")).json();
    const [note] = body.results;
    expect(note.content).toBe("Launch Ship the budget & plan");
    expect(note.snippet).toBe(`Launch Ship the ${S}budget${E} & plan`);
    expect(note).not.toHaveProperty("body");
    expect(note).not.toHaveProperty("fts_snippet");
  });

  it("prefers the FTS snippet when it marks a match", async () => {
    vi.mocked(queryAll).mockResolvedValueOnce([
      {
        id: "n1",
        type: "note",
        title: "Launch",
        body: "irrelevant",
        fts_snippet: `…the **${S}budget${E}** is set…`,
        slug: "launch",
        created_at: "2026-10-01 10:00:00",
        updated_at: "2026-10-01 10:00:00",
        rank: -1,
      },
    ]);

    const body = await (await search("budget", "note")).json();
    expect(body.results[0].snippet).toBe(`…the ${S}budget${E} is set…`);
  });

  it("titles a capture with its opening words, not its type", async () => {
    vi.mocked(queryAll).mockResolvedValueOnce([
      {
        id: "c1",
        type: "capture",
        capture_type: "thought",
        body: "Call the supplier about the budget",
        created_at: "2026-10-01 10:00:00",
        updated_at: "2026-10-01 10:00:00",
      },
    ]);

    const body = await (await search("budget", "capture")).json();
    expect(body.results[0].title).toBe("Call the supplier about the budget");
    expect(body.results[0].snippet).toContain(`${S}budget${E}`);
  });
});
