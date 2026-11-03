/**
 * Swipe gestures: the rules, with no DOM.
 *
 * One vocabulary for the whole app, modelled on the platforms people already
 * know (Apple Mail, Gmail, Reminders):
 *
 * - **Swipe a row right** for its *leading* action (Done, Dismiss).
 * - **Swipe a row left** for its *trailing* actions (Tomorrow, Archive, Delete).
 * - A **short swipe** opens the row and shows the actions as buttons; a **long
 *   or fast swipe** commits the first action on that side straight away.
 * - **Swipe a card or deck** sideways to move through it, like a carousel.
 *
 * Everything here is pure so the thresholds are tested rather than tuned by
 * feel on one phone. Imports nothing.
 */

/** Pixels a finger must travel before we decide which way it is going. */
export const AXIS_LOCK_PX = 8;
/** Width of one revealed action button. */
export const ACTION_WIDTH_PX = 76;
/** Share of the row's width past which releasing commits the first action. */
export const COMMIT_RATIO = 0.42;
/** Never require more than this much travel to commit, on very wide rows. */
export const COMMIT_MAX_PX = 220;
/** A flick at least this fast (px/ms) commits or opens regardless of distance. */
export const FLICK_VELOCITY = 0.55;
/** Travel needed for a release to leave the row open rather than snap shut. */
export const OPEN_MIN_PX = 44;

export type SwipeSide = "leading" | "trailing";
export type Axis = "x" | "y" | null;

/**
 * Which way a gesture is going, once it has gone far enough to tell. `null`
 * means "not yet": the caller keeps watching. A gesture that is mostly
 * vertical is a scroll and belongs to the page.
 */
export function lockAxis(dx: number, dy: number, threshold = AXIS_LOCK_PX): Axis {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (Math.max(ax, ay) < threshold) return null;
  // Bias toward vertical: a diagonal drag in a list is almost always a scroll.
  return ax > ay * 1.2 ? "x" : "y";
}

/** iOS-style resistance: movement past `limit` counts for less and less. */
export function rubberBand(distance: number, limit: number): number {
  if (limit <= 0) return 0;
  const sign = distance < 0 ? -1 : 1;
  const d = Math.abs(distance);
  if (d <= limit) return distance;
  const over = d - limit;
  return sign * (limit + (over * limit) / (over + limit) / 2);
}

export function commitDistance(width: number): number {
  return Math.min(COMMIT_MAX_PX, Math.max(96, width * COMMIT_RATIO));
}

export interface SwipeSides {
  leadingCount: number;
  trailingCount: number;
}

/**
 * Where the row's content should sit for a raw finger offset. A side with no
 * actions barely moves (so the row still feels alive), and travel well past the
 * commit point is damped.
 */
export function dragOffset(dx: number, width: number, sides: SwipeSides): number {
  const side = dx > 0 ? sides.leadingCount : sides.trailingCount;
  if (side === 0) return Math.sign(dx) * Math.min(Math.abs(dx) * 0.15, 24);
  const limit = commitDistance(width) * 1.25;
  return rubberBand(dx, limit);
}

export type SwipeOutcome =
  | { kind: "closed" }
  | { kind: "open"; side: SwipeSide; offset: number }
  | { kind: "commit"; side: SwipeSide };

/**
 * What a release means.
 *
 * `offset` is where the content is (after `dragOffset`), `velocity` is px/ms in
 * the same direction convention (positive = rightward). `openSide` is the side
 * already open when the drag began, so a swipe back toward the centre closes
 * the row instead of committing anything.
 */
export function settleSwipe(input: {
  offset: number;
  velocity: number;
  width: number;
  sides: SwipeSides;
  openSide?: SwipeSide | null;
}): SwipeOutcome {
  const { offset, velocity, width, sides, openSide = null } = input;
  const side: SwipeSide | null = offset > 0 ? "leading" : offset < 0 ? "trailing" : null;
  if (!side) return { kind: "closed" };

  const count = side === "leading" ? sides.leadingCount : sides.trailingCount;
  if (count === 0) return { kind: "closed" };

  const distance = Math.abs(offset);
  const towardCentre = (side === "leading" && velocity < -FLICK_VELOCITY) || (side === "trailing" && velocity > FLICK_VELOCITY);
  if (towardCentre) return { kind: "closed" };

  const outward = side === "leading" ? velocity : -velocity;
  const commitAt = commitDistance(width);

  if (distance >= commitAt) return { kind: "commit", side };
  // A fast flick from closed commits — the "swipe it away" gesture — but only
  // once the finger has clearly meant it, so a nervous twitch never completes
  // a task.
  if (outward >= FLICK_VELOCITY * 1.6 && distance >= OPEN_MIN_PX * 1.5 && openSide !== side) {
    return { kind: "commit", side };
  }
  if (distance >= OPEN_MIN_PX || outward >= FLICK_VELOCITY) {
    const open = count * ACTION_WIDTH_PX;
    return { kind: "open", side, offset: side === "leading" ? open : -open };
  }
  return { kind: "closed" };
}

/** 0 → 1 as the content travels from rest to the commit point. */
export function commitProgress(offset: number, width: number): number {
  return Math.max(0, Math.min(1, Math.abs(offset) / commitDistance(width)));
}

/**
 * Carousel paging: which page a release lands on. A drag past a fifth of the
 * page, or a flick, moves one page; the result is clamped to the deck.
 */
export function pageAfterSwipe(input: {
  index: number;
  count: number;
  dx: number;
  velocity: number;
  width: number;
}): number {
  const { index, count, dx, velocity, width } = input;
  if (count <= 0) return 0;
  let step = 0;
  if (Math.abs(dx) > Math.max(40, width * 0.2) || Math.abs(velocity) > FLICK_VELOCITY) {
    // Positive dx (finger moved right) reveals the previous page.
    step = (Math.abs(dx) > 4 ? dx : velocity) > 0 ? -1 : 1;
  }
  return Math.max(0, Math.min(count - 1, index + step));
}

/**
 * Card gestures (the Mind map's card): left / right / down / up, or nothing.
 * Needs a decisive distance or a flick on the dominant axis.
 */
export type CardSwipe = "left" | "right" | "up" | "down" | null;

export function cardSwipe(dx: number, dy: number, velocity: { x: number; y: number }, distance = 56): CardSwipe {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax >= ay) {
    if (ax >= distance || (ax >= 24 && Math.abs(velocity.x) > FLICK_VELOCITY)) return dx > 0 ? "right" : "left";
    return null;
  }
  if (ay >= distance || (ay >= 24 && Math.abs(velocity.y) > FLICK_VELOCITY)) return dy > 0 ? "down" : "up";
  return null;
}
