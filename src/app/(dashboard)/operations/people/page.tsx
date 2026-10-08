import { Suspense } from "react";
import { PeopleView } from "@/components/operations/people-view";

export default function Page() {
  return (
    <Suspense>
      <PeopleView />
    </Suspense>
  );
}
