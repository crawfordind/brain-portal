/**
 * Navigation Constants
 *
 * Shared navigation configuration used across navigation surfaces.
 *
 * The per-surface item lists that used to live here (`mainNav`,
 * `secondaryNav`, `bottomNavItems`) were a second, diverging source of truth:
 * they still listed a "Dashboard" and a "Chat" entry that no surface renders,
 * while the sidebar and bottom nav each declared their own arrays. What is
 * genuinely shared — the brand and the active-route rule — stays here; the
 * item lists live with the component that renders them.
 *
 * @module navigation
 */

import { Brain, type LucideIcon } from "lucide-react";

/**
 * Navigation item type definition
 */
export interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
}

/**
 * App branding
 */
export const appBranding = {
  name: "Brain Portal",
  shortName: "Brain",
  icon: Brain,
};

/**
 * Check if a route is active based on the current pathname
 *
 * @param pathname - Current pathname from usePathname()
 * @param href - Route href to check
 * @returns true if the route is active
 */
export function isActiveRoute(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/";
  }
  return pathname === href || pathname.startsWith(href + "/");
}

/**
 * How wide the content column is allowed to get, per route.
 *
 * `max-w-4xl` (896px) is a *reading* measure — right for a note, the editor and
 * a settings form, where long lines are genuinely harder to read. It was
 * applied globally, so the dashboard inherited it too and discarded ~780px of a
 * 1920px display: about 41% of the screen, on the one page that is a list of
 * short rows rather than prose.
 *
 * The dashboard therefore gets its own measure. It stops at `6xl` (1152px)
 * rather than going full-bleed because nothing occupies the far right yet — a
 * 1600px row with a title on one end and a timestamp on the other is worse than
 * a narrow one, not better. The right rail lands in Phase 3 and takes the rest.
 *
 * Kept here, next to `isActiveRoute`, so route-shape knowledge stays in one
 * place instead of as a conditional buried in the layout's JSX.
 */
export function contentWidthClass(pathname: string): string {
  return pathname === "/" ? "max-w-6xl" : "max-w-4xl";
}
