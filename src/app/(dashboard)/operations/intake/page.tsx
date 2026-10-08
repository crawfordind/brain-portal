import { Suspense } from "react";
import { IntakeView } from "@/components/operations/intake-view";

export default function Page() {
  return (
    <Suspense>
      <IntakeView />
    </Suspense>
  );
}
