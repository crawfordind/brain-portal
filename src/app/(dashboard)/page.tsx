import { getCurrentUser } from "@/lib/auth";
import { getStreamStats } from "@/lib/stream/stats";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { StreamPage } from "@/components/stream";

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function StreamSkeleton() {
  // The brain's own backdrop with a soft glow where the moment will settle.
  return (
    <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(ellipse_at_50%_45%,#ffffff_0%,#f3f5fb_55%,#e6ebf5_100%)] dark:bg-[radial-gradient(ellipse_at_50%_45%,#18203a_0%,#0e1427_55%,#070a14_100%)]">
      <div className="h-24 w-24 animate-pulse rounded-full bg-amber-200/40 blur-2xl dark:bg-amber-200/20" />
    </div>
  );
}

async function StreamContent() {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/login");

  // The brain loads its own items client-side; the server supplies only the
  // day's one piece of encouragement. The CRM summary moved to Operations.
  const stats = await getStreamStats(user.id);

  return <StreamPage stats={stats} greeting={getGreeting()} />;
}

export default async function HomePage() {
  return (
    <Suspense fallback={<StreamSkeleton />}>
      <StreamContent />
    </Suspense>
  );
}
