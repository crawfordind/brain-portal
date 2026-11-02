import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "../../helpers/render";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "dark" }) }));
// No WebGL in jsdom: make the scene fail the way a real unsupported device would.
vi.mock("@/components/stream/mind/mind-scene", () => ({
  MindScene: class {
    constructor() {
      throw new Error("WebGL unavailable");
    }
  },
}));

import { MindView } from "@/components/stream/mind/mind-view";

function day(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const old = new Date(Date.now() - 9 * 86400000).toISOString();
const items = [
  { id: "n1", type: "note", status: "active", title: "Reading list", priority: "low", tags: [], createdAt: old, updatedAt: old },
  { id: "t1", type: "task", status: "active", title: "Renew passport", priority: "high", dueDate: day(-3), tags: [], createdAt: old, updatedAt: old },
];

describe("MindView", () => {
  beforeEach(() => {
    push.mockReset();
    global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.startsWith("/api/stream?")) {
        return new Response(JSON.stringify({ items, counts: {}, hasMore: false }));
      }
      if (init?.method === "PATCH") return new Response("{}");
      return new Response("{}", { status: 404 });
    }) as typeof fetch;
  });
  afterEach(() => vi.restoreAllMocks());

  it("puts the most important thing in the card and falls back to a ranked list without WebGL", async () => {
    renderWithProviders(<MindView />);

    expect(await screen.findByRole("heading", { level: 2, name: "Renew passport" })).toBeInTheDocument();
    expect(screen.getAllByText("Overdue by 3 days").length).toBeGreaterThan(0);
    await waitFor(() =>
      expect(screen.getByText(/can't draw the map/i)).toBeInTheDocument()
    );

    const list = screen.getByRole("list");
    const rows = list.querySelectorAll("li");
    expect(rows[0].textContent).toContain("Renew passport");
    expect(rows[1].textContent).toContain("Reading list");
  });

  it("asks for due-soonest tasks as well as recent items", async () => {
    renderWithProviders(<MindView />);
    await screen.findByRole("heading", { level: 2, name: "Renew passport" });
    const urls = vi.mocked(global.fetch).mock.calls.map(([u]) => String(u));
    expect(urls.some((u) => u.includes("sort=due"))).toBe(true);
  });

  it("marks the moment done and lets the next thing take its place", async () => {
    renderWithProviders(<MindView />);
    await screen.findByRole("heading", { level: 2, name: "Renew passport" });

    fireEvent.click(screen.getByRole("button", { name: /done/i }));

    expect(await screen.findByRole("heading", { level: 2, name: "Reading list" })).toBeInTheDocument();
    const patch = vi.mocked(global.fetch).mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(String(patch?.[0])).toBe("/api/tasks/t1");
  });

  it("steps through items by importance", async () => {
    renderWithProviders(<MindView />);
    await screen.findByRole("heading", { level: 2, name: "Renew passport" });
    fireEvent.click(screen.getByRole("button", { name: "Less important" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Reading list" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(push).toHaveBeenCalledWith("/notes/n1");
  });
});
