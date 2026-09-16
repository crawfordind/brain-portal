"use client";

import { useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, WifiOff, ShieldAlert, RotateCcw } from "lucide-react";

function classifyError(error: Error) {
  const msg = error.message?.toLowerCase() ?? "";
  if (msg.includes("network") || msg.includes("fetch") || msg.includes("failed to fetch") || msg.includes("offline")) {
    return "network" as const;
  }
  if (msg.includes("401") || msg.includes("unauthorized") || msg.includes("session")) {
    return "auth" as const;
  }
  return "unknown" as const;
}

const ERROR_CONFIG = {
  network: {
    icon: WifiOff,
    title: "Connection problem",
    description: "Couldn’t reach the server. Check your internet connection and try again.",
  },
  auth: {
    icon: ShieldAlert,
    title: "Session expired",
    description: "Your session may have expired. Try refreshing, or sign in again.",
  },
  unknown: {
    icon: AlertTriangle,
    title: "Something went wrong",
    description: "An unexpected error occurred. Your data is safe — try refreshing or come back in a moment.",
  },
} as const;

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[DashboardError]", error);
  }, [error]);

  const errorType = useMemo(() => classifyError(error), [error]);
  const config = ERROR_CONFIG[errorType];
  const Icon = config.icon;

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="mx-auto max-w-md text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/10 mb-3">
          <Icon className="h-5 w-5 text-destructive" />
        </div>
        <h2 className="mt-4 text-lg font-semibold">{config.title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {config.description}
        </p>
        <div className="mt-6 flex justify-center gap-3">
          {errorType === "auth" ? (
            <Button onClick={() => window.location.href = "/auth/login"}>
              Sign in
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => window.location.reload()}>
                Refresh page
              </Button>
              <Button onClick={reset}>
                <RotateCcw className="mr-2 h-4 w-4" />
                Try again
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
