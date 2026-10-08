import { Suspense } from "react";
import { AutomationsView } from "@/components/operations/automations-view";

export default function Page() {
  return (
    <Suspense>
      <AutomationsView />
    </Suspense>
  );
}
