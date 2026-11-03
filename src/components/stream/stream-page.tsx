"use client";

/**
 * Stream Page: the home screen, and the centre of the app.
 *
 * One thing, full screen: the user's brain (`./mind`), ranked by what needs
 * them now. Moment, Today and Life are the three scales of the same picture.
 * Everything that used to be stacked above it now lives somewhere it fits:
 *
 *   - **Capture** is the composer button floating beside the brain (speak or
 *     type), not a full-width bar.
 *   - **Overdue, due today, waiting for review, people to follow up with or
 *     sort** are lights in the brain, ranked with everything else.
 *   - **The counts and the CRM summary** ("Needs you", "People") moved to
 *     Operations › Today, and the chronological list with its filter chips to
 *     Operations › Activity.
 *   - **Notifications** stay on the bell in the header.
 */

import { MindView } from "./mind/mind-view";
import type { StreamStats } from "@/lib/stream/stats";

interface StreamPageProps {
  stats: Pick<StreamStats, "completedToday">;
  greeting: string;
}

export function StreamPage({ stats, greeting }: StreamPageProps) {
  return <MindView greeting={greeting} completedToday={stats.completedToday} />;
}
