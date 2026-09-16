import { getCurrentUser } from "@/lib/auth";
import { getStreamStats } from "@/lib/stream/stats";
import { getCrmPulse } from "@/lib/crm/pulse";
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
  return (
    <div className="space-y-4 p-3 lg:p-6">
      <div className="h-8 w-48 bg-muted animate-pulse rounded-lg" />
      <div className="h-24 bg-muted animate-pulse rounded-2xl" />
      <div className="flex gap-2">
        <div className="h-10 w-24 bg-muted animate-pulse rounded-xl" />
        <div className="h-10 w-24 bg-muted animate-pulse rounded-xl" />
        <div className="h-10 w-24 bg-muted animate-pulse rounded-xl" />
      </div>
      <div className="space-y-3">
        <div className="h-20 bg-muted animate-pulse rounded-xl" />
        <div className="h-20 bg-muted animate-pulse rounded-xl" />
        <div className="h-20 bg-muted animate-pulse rounded-xl" />
      </div>
    </div>
  );
}

async function StreamContent() {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/login");

  // Both are independent reads and neither throws; a slow CRM must not hold
  // up the rest of the page.
  const [stats, crm] = await Promise.all([
    getStreamStats(user.id),
    getCrmPulse(user.id),
  ]);

  return <StreamPage stats={stats} crm={crm} greeting={getGreeting()} />;
}

export default async function HomePage() {
  return (
    <Suspense fallback={<StreamSkeleton />}>
      <StreamContent />
    </Suspense>
  );
}
