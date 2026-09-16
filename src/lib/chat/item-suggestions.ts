/**
 * Opening moves offered when a chat is pinned to a single item.
 *
 * These replace the delegate dialog's prefilled instruction blob. That blob
 * glued a four-point boilerplate prompt onto the item's own text and dropped
 * the result in a textarea, so the user's first job was editing a wall of
 * text they did not write. A chip is one tap, and typing something else
 * instead is always the obvious alternative.
 *
 * Pure and data-only so the set can be unit-tested and reused anywhere an
 * item is the subject.
 */

import type { ChatItemType } from "./item-types";

export interface ItemSuggestion {
  /** Chip label — short enough to read at a glance. */
  label: string;
  /** What actually gets sent. */
  prompt: string;
}

const COMMON: ItemSuggestion[] = [
  {
    label: "What am I missing?",
    prompt: "What am I missing here? Point out gaps, weak assumptions, and anything I've glossed over.",
  },
];

const BY_TYPE: Record<ChatItemType, ItemSuggestion[]> = {
  note: [
    { label: "Give me feedback", prompt: "Give me direct feedback on this note. What works, what doesn't, and what would make it stronger?" },
    { label: "Tighten it", prompt: "Rewrite this more tightly, keeping my voice and every substantive point." },
    { label: "Next steps", prompt: "Based on this note, what are the concrete next steps? Be specific enough to act on today." },
  ],
  journal: [
    { label: "Find the pattern", prompt: "What patterns or themes do you see in this entry, especially ones I might not have noticed?" },
    { label: "Draw it out", prompt: "Ask me the one question that would get the most out of what I've written here." },
    { label: "Next steps", prompt: "What should I actually do off the back of this? Be specific." },
  ],
  capture: [
    { label: "Develop this", prompt: "Develop this thought into something more complete. Where does it lead?" },
    { label: "Make it concrete", prompt: "Turn this into something concrete and actionable. What would doing it actually involve?" },
    { label: "Push back", prompt: "Push back on this. What's the strongest case against it?" },
  ],
  thought: [
    { label: "Develop this", prompt: "Develop this thought into something more complete. Where does it lead?" },
    { label: "Make it concrete", prompt: "Turn this into something concrete and actionable. What would doing it actually involve?" },
    { label: "Push back", prompt: "Push back on this. What's the strongest case against it?" },
  ],
  task: [
    { label: "How do I start?", prompt: "Give me a concrete starting point for this task — the actual first move, not a breakdown structure." },
    { label: "Break it down", prompt: "Break this into a short sequence of steps I can work through." },
    { label: "Just do it", prompt: "Do as much of this task as you can right now, and tell me what's left for me." },
  ],
  reminder: [
    { label: "Prep me", prompt: "Prepare me for this. What context do I need, and what should I have ready?" },
    { label: "What could go wrong?", prompt: "What should I anticipate here? What tends to go wrong with this kind of thing?" },
    { label: "Draft it", prompt: "Draft whatever this needs from me — a message, an outline, a checklist. Pick the most useful one." },
  ],
  insight: [
    { label: "Go deeper", prompt: "Take this further. What follows from it that isn't obvious yet?" },
    { label: "Is it true?", prompt: "Stress-test this. What evidence supports it, and what would falsify it?" },
    { label: "So what?", prompt: "What should I actually change because of this? Be specific." },
  ],
};

/** Suggested opening prompts for an item of this type. */
export function getItemSuggestions(type: ChatItemType | null | undefined): ItemSuggestion[] {
  if (!type) return COMMON;
  return [...(BY_TYPE[type] ?? []), ...COMMON];
}
