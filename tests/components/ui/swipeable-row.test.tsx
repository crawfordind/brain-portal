import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { Archive, Check } from "lucide-react";
import { SwipeableRow } from "@/components/ui/swipeable-row";

/** jsdom has no PointerEvent; fireEvent.pointer* needs the fields we read. */
function pointer(el: Element, type: "pointerDown" | "pointerMove" | "pointerUp", x: number, pointerType = "touch", t = 0) {
  fireEvent[type](el, { clientX: x, clientY: 10, pointerId: 1, pointerType, isPrimary: true, timeStamp: t });
}

function setup() {
  const done = vi.fn();
  const archive = vi.fn();
  const open = vi.fn();
  render(
    <SwipeableRow
      leading={[{ id: "done", label: "Done", icon: Check, tone: "done", onAction: done }]}
      trailing={[{ id: "archive", label: "Archive", icon: Archive, tone: "archive", onAction: archive }]}
    >
      <button onClick={open}>Row</button>
    </SwipeableRow>
  );
  const content = screen.getByText("Row").parentElement!;
  return { done, archive, open, content };
}

describe("SwipeableRow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener() {}, removeEventListener() {} });
  });
  afterEach(() => vi.useRealTimers());

  it("commits the leading action on a long right swipe, without also tapping the row", () => {
    const { done, open, content } = setup();
    pointer(content, "pointerDown", 0);
    pointer(content, "pointerMove", 20, "touch", 10);
    pointer(content, "pointerMove", 240, "touch", 200);
    pointer(content, "pointerUp", 240, "touch", 210);
    fireEvent.click(screen.getByText("Row"));
    act(() => vi.runAllTimers());
    expect(done).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();
  });

  it("commits the trailing action on a long left swipe", () => {
    const { archive, content } = setup();
    pointer(content, "pointerDown", 300);
    pointer(content, "pointerMove", 280, "touch", 10);
    pointer(content, "pointerMove", 60, "touch", 200);
    pointer(content, "pointerUp", 60, "touch", 210);
    act(() => vi.runAllTimers());
    expect(archive).toHaveBeenCalledOnce();
  });

  it("ignores a mouse drag, which is a text selection, not a swipe", () => {
    const { done, content } = setup();
    pointer(content, "pointerDown", 0, "mouse");
    pointer(content, "pointerMove", 240, "mouse", 200);
    pointer(content, "pointerUp", 240, "mouse", 210);
    act(() => vi.runAllTimers());
    expect(done).not.toHaveBeenCalled();
  });

  it("keeps hidden action buttons out of the tab order until opened", () => {
    setup();
    for (const b of screen.getAllByRole("button", { hidden: true }).filter((b) => b.textContent !== "Row")) {
      expect(b.getAttribute("tabindex")).toBe("-1");
    }
  });

  it("a plain tap still opens the row", () => {
    const { open } = setup();
    fireEvent.click(screen.getByText("Row"));
    expect(open).toHaveBeenCalledOnce();
  });
});
