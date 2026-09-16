'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';

function AgentsRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const taskId = searchParams.get('task');
    if (taskId) {
      router.replace(`/review?task=${taskId}`);
    } else {
      router.replace('/review');
    }
  }, [router, searchParams]);

  return (
    <div className="flex items-center justify-center py-24 text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin mr-2" />
      <span className="text-sm">Redirecting to Review&hellip;</span>
    </div>
  );
}

export default function AgentsPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        <span className="text-sm">Loading&hellip;</span>
      </div>
    }>
      <AgentsRedirect />
    </Suspense>
  );
}
