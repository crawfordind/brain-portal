import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../../helpers/render";

let pathname = "/";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "dark", setTheme: vi.fn() }) }));
vi.mock("@/components/layout/nav-shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/layout/nav-shared")>();
  return { ...actual, useNavBadges: () => () => 0 };
});

import { AgenticBottomNav } from "@/components/layout/agentic-bottom-nav";

describe("dock centre button", () => {
  beforeEach(() => {
    global.fetch = vi.fn(async () => new Response("{}")) as typeof fetch;
  });

  it("is the + (capture) on the stream", () => {
    pathname = "/";
    renderWithProviders(<AgenticBottomNav />);
    expect(screen.getByRole("button", { name: /capture a thought/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^stream/i })).not.toBeInTheDocument();
    // Tasks keeps its place in the dock.
    expect(screen.getByRole("link", { name: /^tasks/i })).toBeInTheDocument();
  });

  it("is the way back to the stream on any other page", () => {
    pathname = "/notes";
    renderWithProviders(<AgenticBottomNav />);
    expect(screen.getByRole("link", { name: /^stream/i })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("button", { name: /capture a thought/i })).not.toBeInTheDocument();
  });
});
