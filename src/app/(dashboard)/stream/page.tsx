import { redirect } from "next/navigation";

/**
 * `/stream` and `/` rendered the same StreamPage from two identical copies of
 * the same file — two URLs for one screen, drifting apart on every edit. The
 * Stream is the dashboard root; this route just points at it so existing links
 * and bookmarks keep working.
 */
export default function StreamRoutePage() {
  redirect("/");
}
