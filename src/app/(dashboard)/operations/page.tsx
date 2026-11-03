import { getCurrentUser } from "@/lib/auth";
import { getStreamStats } from "@/lib/stream/stats";
import { getCrmPulse } from "@/lib/crm/pulse";
import { redirect } from "next/navigation";
import { OperationsHome } from "@/components/operations/operations-home";
import { NeedsYou } from "@/components/stream/needs-you";
import { CrmPulseCard } from "@/components/stream/crm-pulse-card";

/**
 * Operations › Today. Above the command screen sit the two summaries that
 * used to crowd the home screen: one row of what is waiting ("Needs you"),
 * and the People card. The home screen draws the same things as lights in
 * the brain; here they are counts with links.
 */
export default async function OperationsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/login");

  // Independent reads, and neither throws.
  const [stats, crm] = await Promise.all([getStreamStats(user.id), getCrmPulse(user.id)]);

  return (
    <div className="space-y-4">
      <NeedsYou
        counts={{
          overdueTasks: stats.overdueTasks,
          dueTodayTasks: stats.dueTodayTasks,
          awaitingReview: stats.awaitingReview,
          crmNeedsReview: crm.needsReview,
          crmFollowUpsDue: crm.followUpsDue,
        }}
      />
      <CrmPulseCard pulse={crm} />
      <OperationsHome />
    </div>
  );
}
