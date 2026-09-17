import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Multi-line writing surface. Grows with its content; see `.bp-field` in
 * globals.css for why it is a rule under the text rather than a box around it.
 */
function Textarea({
  className,
  variant = "line",
  ...props
}: React.ComponentProps<"textarea"> & { variant?: "line" | "boxed" }) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        variant === "boxed"
          ? "border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 flex field-sizing-content min-h-16 w-full rounded-md border bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
          : "bp-field bp-field-multiline block min-h-16 text-base md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
