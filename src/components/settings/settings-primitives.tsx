/**
 * The building blocks every settings section is drawn with, so a section reads
 * like the others: a titled group of rows, each a label, one line of
 * explanation, and its control on the right (below, on a narrow screen).
 */

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function SettingsGroup({
  title,
  description,
  children,
  className,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-2", className)}>
      {(title || description) && (
        <div className="px-1">
          {title && <h3 className="text-sm font-semibold">{title}</h3>}
          {description && (
            <p className="text-xs text-muted-foreground">{description}</p>
          )}
        </div>
      )}
      <div className="divide-y rounded-xl border bg-card">{children}</div>
    </section>
  );
}

export function SettingsRow({
  label,
  description,
  htmlFor,
  children,
  stackOnMobile = false,
  tone,
}: {
  label: ReactNode;
  description?: ReactNode;
  /** The control's id, so tapping the label toggles it. */
  htmlFor?: string;
  /** The control: a switch, a button, a value. */
  children?: ReactNode;
  /** Put a wide control (a button) under the text on a phone. */
  stackOnMobile?: boolean;
  tone?: "danger";
}) {
  const Label = htmlFor ? "label" : "div";
  return (
    <div
      className={cn(
        "flex min-h-14 gap-x-4 gap-y-3 px-4 py-3",
        stackOnMobile
          ? "flex-col sm:flex-row sm:items-center sm:justify-between"
          : "items-center justify-between"
      )}
    >
      <Label htmlFor={htmlFor} className="min-w-0 space-y-0.5">
        <span
          className={cn(
            "block text-sm font-medium",
            tone === "danger" && "text-destructive"
          )}
        >
          {label}
        </span>
        {description && (
          <span className="block text-xs text-muted-foreground">
            {description}
          </span>
        )}
      </Label>
      {children && <div className="shrink-0">{children}</div>}
    </div>
  );
}
