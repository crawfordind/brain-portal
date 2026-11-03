import { describe, expect, it } from "vitest";
import {
  ACTION_WIDTH_PX,
  cardSwipe,
  commitDistance,
  commitProgress,
  dragOffset,
  lockAxis,
  pageAfterSwipe,
  rubberBand,
  settleSwipe,
} from "@/lib/gestures/swipe";

const both = { leadingCount: 1, trailingCount: 2 };

describe("lockAxis", () => {
  it("waits until the finger has moved far enough", () => {
    expect(lockAxis(3, 2)).toBeNull();
  });
  it("locks horizontal for a clearly sideways drag", () => {
    expect(lockAxis(20, 4)).toBe("x");
  });
  it("treats a diagonal drag as a scroll", () => {
    expect(lockAxis(12, 11)).toBe("y");
    expect(lockAxis(2, 30)).toBe("y");
  });
});

describe("rubberBand", () => {
  it("is linear inside the limit and damped past it", () => {
    expect(rubberBand(50, 100)).toBe(50);
    expect(rubberBand(300, 100)).toBeLessThan(150);
    expect(rubberBand(-300, 100)).toBeGreaterThan(-150);
  });
});

describe("dragOffset", () => {
  it("barely moves toward a side with no actions", () => {
    expect(Math.abs(dragOffset(200, 360, { leadingCount: 0, trailingCount: 1 }))).toBeLessThanOrEqual(24);
  });
  it("follows the finger toward a side with actions", () => {
    expect(dragOffset(80, 360, both)).toBe(80);
    expect(dragOffset(-80, 360, both)).toBe(-80);
  });
});

describe("settleSwipe", () => {
  const width = 360;
  it("snaps shut on a tiny drag", () => {
    expect(settleSwipe({ offset: 20, velocity: 0.1, width, sides: both })).toEqual({ kind: "closed" });
  });
  it("opens to show the buttons on a short drag", () => {
    expect(settleSwipe({ offset: -60, velocity: -0.1, width, sides: both })).toEqual({
      kind: "open",
      side: "trailing",
      offset: -2 * ACTION_WIDTH_PX,
    });
  });
  it("commits the first action past the commit point", () => {
    const far = commitDistance(width) + 1;
    expect(settleSwipe({ offset: far, velocity: 0, width, sides: both })).toEqual({ kind: "commit", side: "leading" });
  });
  it("commits on a decisive flick, never on a twitch", () => {
    expect(settleSwipe({ offset: 70, velocity: 1.2, width, sides: both })).toEqual({ kind: "commit", side: "leading" });
    expect(settleSwipe({ offset: 30, velocity: 1.2, width, sides: both }).kind).not.toBe("commit");
  });
  it("closes when flicked back toward the centre", () => {
    expect(settleSwipe({ offset: 100, velocity: -1, width, sides: both })).toEqual({ kind: "closed" });
  });
  it("never commits a side without actions", () => {
    expect(settleSwipe({ offset: 300, velocity: 2, width, sides: { leadingCount: 0, trailingCount: 1 } })).toEqual({
      kind: "closed",
    });
  });
  it("does not flick-commit a side that was already open", () => {
    const out = settleSwipe({ offset: 130, velocity: 1.2, width, sides: both, openSide: "leading" });
    expect(out.kind).toBe("open");
  });
});

describe("commitProgress", () => {
  it("runs 0 to 1", () => {
    expect(commitProgress(0, 360)).toBe(0);
    expect(commitProgress(-9999, 360)).toBe(1);
  });
});

describe("pageAfterSwipe", () => {
  it("moves one page on a real drag and clamps at the ends", () => {
    expect(pageAfterSwipe({ index: 0, count: 3, dx: -120, velocity: 0, width: 300 })).toBe(1);
    expect(pageAfterSwipe({ index: 0, count: 3, dx: 120, velocity: 0, width: 300 })).toBe(0);
    expect(pageAfterSwipe({ index: 2, count: 3, dx: -120, velocity: 0, width: 300 })).toBe(2);
  });
  it("stays put on a small drag", () => {
    expect(pageAfterSwipe({ index: 1, count: 3, dx: -20, velocity: 0.1, width: 300 })).toBe(1);
  });
});

describe("cardSwipe", () => {
  it("reads the dominant direction", () => {
    expect(cardSwipe(-80, 10, { x: 0, y: 0 })).toBe("left");
    expect(cardSwipe(80, 10, { x: 0, y: 0 })).toBe("right");
    expect(cardSwipe(5, 70, { x: 0, y: 0 })).toBe("down");
  });
  it("ignores small drags unless flicked", () => {
    expect(cardSwipe(30, 0, { x: 0.1, y: 0 })).toBeNull();
    expect(cardSwipe(30, 0, { x: 1, y: 0 })).toBe("right");
  });
});
