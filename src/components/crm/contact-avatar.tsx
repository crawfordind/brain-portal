"use client";

/**
 * The thing the eye lands on before it reads the name.
 *
 * There are no photographs in this data and there never will be — contacts are
 * extracted from notes the user wrote — so the avatar is built from initials.
 * Two rules govern it:
 *
 * - **The colour is derived, never random.** Seeded from the entity id, so a
 *   contact keeps the same circle across renders, reloads, renames and
 *   re-sorts. A colour that changes carries no information; a stable one lets
 *   the user recognise a row before reading it.
 * - **Colour is never the only signal.** People are circles and everything else
 *   is a squircle, so the person/organisation split survives a greyscale
 *   screenshot, a monochrome display and the ~8% of men who would not see the
 *   hues apart anyway.
 *
 * Tones map onto the `--chart-N` design tokens, so both themes are handled by
 * the tokens rather than by a second hardcoded palette.
 */

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { avatarToneFor, initialsFor } from "@/lib/crm/contact-list";
import { cn } from "@/lib/utils";

/**
 * The tint carries the identity; the initials stay `text-foreground`.
 *
 * Colouring the glyphs themselves was the obvious move and the wrong one: the
 * chart tokens sit between 0.55 and 0.75 lightness, which is legible against a
 * dark surface and thin against a light one, so half the palette would fail
 * contrast in one theme or the other. A tinted disc under full-contrast type is
 * distinguishable in both.
 */
const TONE_CLASSES: Record<number, string> = {
  1: "bg-chart-1/20 ring-chart-1/40",
  2: "bg-chart-2/20 ring-chart-2/40",
  3: "bg-chart-3/20 ring-chart-3/40",
  4: "bg-chart-4/20 ring-chart-4/40",
  5: "bg-chart-5/20 ring-chart-5/40",
};

export function ContactAvatar({
  seed,
  name,
  entityType,
  className,
}: {
  /** Stable identity for the colour — the entity id, not the name. */
  seed: string;
  name: string;
  entityType: string;
  className?: string;
}) {
  const isPerson = entityType === "person";
  const tone = TONE_CLASSES[avatarToneFor(seed)] ?? TONE_CLASSES[1];
  const shape = isPerson ? "rounded-full" : "rounded-lg";

  return (
    // The name is already the link's text; announcing initials again would make
    // every row read twice.
    <Avatar aria-hidden className={cn("size-10", shape, className)}>
      <AvatarFallback
        className={cn(
          "text-sm font-semibold text-foreground ring-1 ring-inset",
          shape,
          tone
        )}
      >
        {initialsFor(name)}
      </AvatarFallback>
    </Avatar>
  );
}
