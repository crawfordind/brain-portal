/**
 * /share — the destination for the OS share sheet.
 *
 * Android (and any browser implementing the Web Share Target spec) navigates
 * here with the shared title/text/url as query parameters, per the
 * `share_target` block in the manifest. The same URL is a perfectly good target
 * for an iOS Shortcut, a desktop bookmarklet, or a hand-typed link, which is why
 * the parameter names are read loosely.
 *
 * Rendered outside the dashboard layout on purpose: arriving from a share sheet
 * should feel like a small modal task, not like being dropped into the whole app.
 */

import type { Metadata } from "next";
import { sharedInputFromParams, parseSharedPayload } from "@/lib/share/parse";
import { ShareCaptureForm } from "@/components/share/share-capture-form";

export const metadata: Metadata = {
  title: "Save to Brain Portal",
};

// The payload is entirely request-specific; there is nothing to prerender.
export const dynamic = "force-dynamic";

export default async function SharePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const parsed = parseSharedPayload(sharedInputFromParams(params));

  return (
    <main className="min-h-screen bg-background flex items-start sm:items-center justify-center px-4 py-6 sm:py-10">
      <ShareCaptureForm parsed={parsed} />
    </main>
  );
}
