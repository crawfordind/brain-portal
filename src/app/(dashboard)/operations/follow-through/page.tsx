import { Suspense } from "react";
import { FollowThroughView } from "@/components/operations/follow-through-view";

export default function Page() {
  return (
    <Suspense>
      <FollowThroughView />
    </Suspense>
  );
}
