"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { OfflineProvider } from "@/components/offline";
import { HydrationErrorLogger } from "@/components/hydration-error-logger";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            refetchOnWindowFocus: false,
            // Keep cached data available when offline
            networkMode: "offlineFirst",
            // Don't throw errors when offline - show stale data instead
            retry: (failureCount: number, _error: Error) => {
              // Don't retry if we're offline
              if (typeof navigator !== "undefined" && !navigator.onLine) return false;
              // Otherwise retry up to 2 times
              return failureCount < 2;
            },
            // Keep data in cache longer for offline use
            gcTime: 30 * 60 * 1000, // 30 minutes
          },
          mutations: {
            // Let mutations queue when offline
            networkMode: "offlineFirst",
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        themes={["light", "dark"]}
      >
        <HydrationErrorLogger />
        <TooltipProvider delayDuration={300}>
          <ConfirmProvider>
            <OfflineProvider>{children}</OfflineProvider>
          </ConfirmProvider>
        </TooltipProvider>
        <Toaster />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
