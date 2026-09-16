import { Skeleton } from "@/components/ui/skeleton";

export default function NotesLoading() {
  return (
    <div className="p-3 lg:p-6 space-y-3 lg:space-y-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 lg:gap-4">
        <div>
          <Skeleton className="h-7 w-24 mb-1" />
          <Skeleton className="h-4 w-44" />
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <Skeleton className="h-9 lg:h-10 w-28 flex-1 sm:flex-initial" />
          <Skeleton className="h-9 lg:h-10 w-24 flex-1 sm:flex-initial" />
        </div>
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-6 lg:h-7 w-20 rounded-full" />
        <Skeleton className="h-6 lg:h-7 w-24 rounded-full" />
        <Skeleton className="h-6 lg:h-7 w-28 rounded-full" />
        <Skeleton className="h-6 lg:h-7 w-24 rounded-full" />
      </div>
      <div className="space-y-2 lg:space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-20 lg:h-24 rounded-lg" />
        ))}
      </div>
    </div>
  );
}
