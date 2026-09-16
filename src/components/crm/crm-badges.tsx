"use client";

import { Badge } from "@/components/ui/badge";
import { AlertTriangle, HelpCircle, Lock } from "lucide-react";

/** Human labels for the role edge types. */
export const ROLE_LABELS: Record<string, string> = {
  partner: "Partner",
  collaborator: "Collaborator",
  customer_of: "Customer",
  member_of: "Member",
  advisor_to: "Advisor",
  investor_in: "Investor",
  employed_by: "Employed by",
  reports_to: "Reports to",
  contact_at: "Contact at",
  supplies: "Supplier",
  works_with: "Works with",
  related: "Related",
};

export function RoleBadge({
  edgeType,
  ventureName,
}: {
  edgeType: string;
  ventureName: string;
}) {
  return (
    <Badge variant="secondary" className="font-normal">
      {ROLE_LABELS[edgeType] ?? edgeType} · {ventureName}
    </Badge>
  );
}

/**
 * Compartments are advisory in Phase 0: they are shown and filterable, but
 * nothing is blocked, because no send path or prompt path touches contacts yet.
 */
export function CompartmentBadges({ compartments }: { compartments: string[] }) {
  const meaningful = compartments.filter((c) => c !== "public");
  if (meaningful.length === 0) return null;
  return (
    <>
      {meaningful.map((c) => (
        <Badge
          key={c}
          variant="outline"
          className="border-amber-500/40 text-amber-700 dark:text-amber-400 font-normal"
        >
          <Lock className="mr-1 h-3 w-3" />
          {c}
        </Badge>
      ))}
    </>
  );
}

export function UnresolvedBadge() {
  return (
    <Badge variant="outline" className="border-dashed font-normal">
      <HelpCircle className="mr-1 h-3 w-3" />
      Unresolved
    </Badge>
  );
}

export function MergeCandidateBadge() {
  return (
    <Badge
      variant="outline"
      className="border-orange-500/50 text-orange-700 dark:text-orange-400 font-normal"
    >
      <AlertTriangle className="mr-1 h-3 w-3" />
      Possible duplicate
    </Badge>
  );
}
