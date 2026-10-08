import { OpsNav } from "@/components/operations/ops-nav";

/**
 * Operations: the decision-and-execution layer over records Brain Portal
 * already owns. Every view reads tasks, projects, contacts and captures; none
 * keeps a copy. See `src/lib/operations/types.ts`.
 */
export default function OperationsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4 p-3 lg:p-6">
      <OpsNav />
      {children}
    </div>
  );
}
