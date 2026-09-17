import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * A text field styled as a line you write on rather than a box you fill in.
 *
 * The visual treatment lives in `.bp-field` (globals.css) so the journal
 * composer, the note editor and every form field in the app share one idea.
 * Pass `variant="boxed"` where a field genuinely needs to read as a discrete
 * control — inside a dense toolbar, say, or next to a button it must visually
 * group with.
 */
function Input({
  className,
  type,
  variant = "line",
  ...props
}: React.ComponentProps<"input"> & { variant?: "line" | "title" | "boxed" }) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "selection:bg-primary selection:text-primary-foreground file:text-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none",
        variant === "boxed"
          ? [
              "placeholder:text-muted-foreground dark:bg-input/30 border-input h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
              "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
              "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
            ]
          : ["bp-field text-base md:text-sm", variant === "title" && "bp-field-title"],
        className
      )}
      {...props}
    />
  )
}

export { Input }
