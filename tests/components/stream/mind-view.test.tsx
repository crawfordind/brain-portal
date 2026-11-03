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

let people: unknown[] = [];

describe("MindView", () => {
  beforeEach(() => {
    push.mockReset();
    people = [];
    global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.startsWith("/api/stream?")) {
        return new Response(JSON.stringify({ items, counts: {}, hasMore: false }));
      }
      if (u === "/api/crm/pulse") {
        return new Response(JSON.stringify({ people }));
      }
      if (init?.method === "PATCH") return new Response("{}");
      return new Response("{}", { status: 404 });
    }) as typeof fetch;
  });
  afterEach(() => vi.restoreAllMocks());

  it("puts the most important thing in the card and falls back to a ranked list without WebGL", async () => {
    renderWithProviders(<MindView greeting="Good morning" />);

    expect(await screen.findByRole("heading", { level: 2, name: "Renew passport" })).toBeInTheDocument();
    expect(screen.getAllByText("Overdue by 3 days").length).toBeGreaterThan(0);
    await waitFor(() =>
      expect(screen.getByText(/can't draw your brain/i)).toBeInTheDocument()
    );

    const list = screen.getByRole("list");
    const rows = list.querySelectorAll("li");
    expect(rows[0].textContent).toContain("Renew passport");
    expect(rows[1].textContent).toContain("Reading list");
  });

  it("asks for due-soonest tasks as well as recent items", async () => {
    renderWithProviders(<MindView greeting="Good morning" />);
    await screen.findByRole("heading", { level: 2, name: "Renew passport" });
    const urls = vi.mocked(global.fetch).mock.calls.map(([u]) => String(u));
    expect(urls.some((u) => u.includes("sort=due"))).toBe(true);
  });

  it("marks the moment done and lets the next thing take its place", async () => {
    renderWithProviders(<MindView greeting="Good morning" />);
    await screen.findByRole("heading", { level: 2, name: "Renew passport" });

    fireEvent.click(screen.getByRole("button", { name: /done/i }));

    expect(await screen.findByRole("heading", { level: 2, name: "Reading list" })).toBeInTheDocument();
    const patch = vi.mocked(global.fetch).mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(String(patch?.[0])).toBe("/api/tasks/t1");
  });

  it("steps through items by importance", async () => {
    renderWithProviders(<MindView greeting="Good morning" />);
    await screen.findByRole("heading", { level: 2, name: "Renew passport" });
    fireEvent.click(screen.getByRole("button", { name: "Less important" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Reading list" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(push).toHaveBeenCalledWith("/notes/n1");
  });

  it("draws people from the CRM in the brain and opens their contact", async () => {
    people = [
      { id: "e1", name: "Dana", entityType: "person", reason: "follow_up", at: "2020-01-01 09:00:00", ventureName: null },
    ];
    renderWithProviders(<MindView greeting="Good morning" />);

    // The overdue high-priority task is the moment; the late follow-up is next,
    // ahead of the plain note.
    await screen.findByRole("heading", { level: 2, name: "Renew passport" });
    fireEvent.click(screen.getByRole("button", { name: "Less important" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Dana" })).toBeInTheDocument();
    expect(screen.getAllByText(/Follow-up .* late/).length).toBeGreaterThan(0);
    // People cannot be completed or archived from here, only opened.
    expect(screen.queryByRole("button", { name: /done/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(push).toHaveBeenCalledWith("/crm/e1");
  });

  it("still shows the brain when the people read fails", async () => {
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).startsWith("/api/stream?")) {
        return new Response(JSON.stringify({ items, counts: {}, hasMore: false }));
      }
      throw new Error("offline");
    }) as typeof fetch;
    renderWithProviders(<MindView greeting="Good morning" />);
    expect(await screen.findByRole("heading", { level: 2, name: "Renew passport" })).toBeInTheDocument();
  });

  it("greets the user and offers speak or type from one button", async () => {
    renderWithProviders(<MindView greeting="Good morning" />);
    await screen.findByRole("heading", { level: 2, name: "Renew passport" });
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /capture a thought/i }));
    expect(await screen.findByRole("menuitem", { name: /type/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /speak/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("menuitem", { name: /type/i }));
    expect(await screen.findByRole("textbox", { name: /what's on your mind/i })).toHaveFocus();
  });

  it("hides the card to a single line and brings it back", async () => {
    renderWithProviders(<MindView greeting="Good morning" />);
    await screen.findByRole("heading", { level: 2, name: "Renew passport" });
    fireEvent.click(screen.getByRole("button", { name: "Hide details" }));
    expect(screen.queryByRole("heading", { level: 2, name: "Renew passport" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /show details/i }));
    expect(screen.getByRole("heading", { level: 2, name: "Renew passport" })).toBeInTheDocument();
  });

  it("toggles immersive mode and remembers it", async () => {
    window.localStorage.clear();
    renderWithProviders(<MindView greeting="Good morning" />);
    await screen.findByRole("heading", { level: 2, name: "Renew passport" });
    fireEvent.click(screen.getByRole("button", { name: /show the top bar/i }));
    expect(window.localStorage.getItem("bp.home.immersive")).toBe("off");
    expect(screen.getByRole("button", { name: /immersive: hide the top bar/i })).toBeInTheDocument();
  });
});
