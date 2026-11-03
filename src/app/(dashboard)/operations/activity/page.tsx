import { StreamFeed } from "@/components/stream";

/**
 * Operations › Activity: everything in the stream, newest first, with the
 * type filters, density control and run collapsing. It used to be the home
 * screen's "List" view; the home screen is now the brain alone.
 */
export default function OperationsActivityPage() {
  return (
    <div className="space-y-3">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
        <p className="text-sm text-muted-foreground">Everything you and your agents added, newest first.</p>
      </header>
      <StreamFeed />
    </div>
  );
}
