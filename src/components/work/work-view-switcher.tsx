"use client";

import Link from "next/link";
import {
  LayoutList,
  Columns3,
  Calendar as CalendarIcon,
  Bot,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type WorkSurface = "list" | "kanban" | "calendar" | "review";

interface SurfaceOption {
  value: WorkSurface;
  icon: LucideIcon;
  label: string;
  href: string;
  /** Board and Calendar need the width; List and Review do not. */
  desktopOnly?: boolean;
}

const SURFACES: SurfaceOption[] = [
  { value: "list", icon: LayoutList, label: "List", href: "/tasks?view=list" },
  { value: "kanban", icon: Columns3, label: "Board", href: "/tasks?view=kanban", desktopOnly: true },
  { value: "calendar", icon: CalendarIcon, label: "Calendar", href: "/tasks?view=calendar", desktopOnly: true },
  { value: "review", icon: Bot, label: "Review", href: "/review" },
];

interface WorkViewSwitcherProps {
  current: WorkSurface;
  isDesktop: boolean;
  /** Agent outputs awaiting a decision. Badged on Review. */
  reviewCount?: number;
}

/**
 * The one control that moves between the surfaces of Work.
 *
 * Review is a peer of List / Board / Calendar rather than something behind a
 * button — reviewing delegated output is the step that turns agent work into
 * finished work, so it should never be more than one click from anywhere in
 * Work. It is a real route (`/review`) rather than a query param so it can be
 * linked, bookmarked, and highlighted without guessing at the URL.
 */
export function WorkViewSwitcher({ current, isDesktop, reviewCount = 0 }: WorkViewSwitcherProps) {
  const visible = SURFACES.filter((s) => isDesktop || !s.desktopOnly);

  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5 shrink-0">
      {visible.map(({ value, icon: Icon, label, href }) => {
        const isActive = current === value;
        return (
          <Link
            key={value}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-xs font-medium transition-colors",
              isActive
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
            {value === "review" && reviewCount > 0 && (
              <Badge className="h-4 min-w-4 rounded-full bg-purple-500 px-1 text-[10px] text-white hover:bg-purple-500">
                {reviewCount}
              </Badge>
            )}
          </Link>
        );
      })}
    </div>
  );
}
