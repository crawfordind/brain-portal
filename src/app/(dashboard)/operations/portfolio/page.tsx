import { Suspense } from "react";
import { PortfolioView } from "@/components/operations/portfolio-view";

export default function Page() {
  return (
    <Suspense>
      <PortfolioView />
    </Suspense>
  );
}
