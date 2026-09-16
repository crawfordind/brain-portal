"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";
import Link from "next/link";

const errorMessages: Record<string, { title: string; description: string }> = {
  missing_params: {
    title: "Invalid Link",
    description: "The sign-in link is missing required information. Please request a new one.",
  },
  invalid_token: {
    title: "Link Expired or Invalid",
    description: "This sign-in link has expired or has already been used. Please request a new one.",
  },
  verification_failed: {
    title: "Verification Failed",
    description: "We couldn't verify your sign-in. Please try again.",
  },
  default: {
    title: "Something Went Wrong",
    description: "An unexpected error occurred. Please try signing in again.",
  },
};

function AuthErrorContent() {
  const searchParams = useSearchParams();
  const reason = searchParams.get("reason") || "default";
  const error = errorMessages[reason] || errorMessages.default;

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
          <AlertCircle className="h-6 w-6 text-destructive" />
        </div>
        <CardTitle>{error.title}</CardTitle>
        <CardDescription>{error.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex justify-center">
        <Button asChild>
          <Link href="/auth/login">Try Again</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export default function AuthErrorPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Suspense fallback={
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted animate-pulse" />
            <div className="h-6 w-32 mx-auto bg-muted animate-pulse rounded" />
          </CardHeader>
        </Card>
      }>
        <AuthErrorContent />
      </Suspense>
    </div>
  );
}
