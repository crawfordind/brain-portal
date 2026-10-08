"use client";

/**
 * The Operations tab strip. Links, not local tabs, so every view has a URL an
 * assistant or a notification can point at. Scrolls sideways on a phone
 * rather than wrapping into two rows.
 */

import Link from "next/link";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export const OPS_TABS = [
  { href: "/operations", label: "Today" },
  { href: "/operations/portfolio", label: "Portfolio" },
  { href: "/operations/follow-through", label: "Follow-through" },
  { href: "/operations/people", label: "People" },
  { href: "/operations/intake", label: "Intake" },
  { href: "/operations/automations", label: "Automations" },
] as const;

export function OpsNav() {
  const pathname = usePathname();
  const activeRef = useRef<HTMLAnchorElement>(null);
  // On a phone the strip scrolls; keep the current view's tab in sight.
  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [pathname]);
  return (
    <nav
      aria-label="Operations views"
      className="-mx-3 flex gap-1 overflow-x-auto scrollbar-none border-b px-3 lg:mx-0 lg:px-0"
    >
      {OPS_TABS.map((tab) => {
        const active =
          tab.href === "/operations" ? pathname === "/operations" : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            ref={active ? activeRef : undefined}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-11 shrink-0 items-center border-b-2 px-3 text-sm transition-colors",
              active
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Section card used by every Operations view. */
export function OpsSectionCard({
  title,
  count,
  hint,
  action,
  children,
  id,
}: {
  title: string;
  count?: number;
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="rounded-xl border bg-card">
      <header className="flex items-start justify-between gap-2 px-3.5 pt-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            {title}
            {count !== undefined && (
              <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium tabular-nums text-muted-foreground">
                {count}
              </span>
            )}
          </h2>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
        {action}
      </header>
      <div className="px-3.5 pb-1.5">{children}</div>
    </section>
  );
}
