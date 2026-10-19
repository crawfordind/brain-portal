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
    title: "Link Not Recognised",
    description:
      "This sign-in link isn't valid. It may have been cut off when it was copied. Open it straight from the email, or request a new one.",
  },
  link_expired: {
    title: "Link Expired",
    description:
      "This sign-in link has expired. Request a new one. Earlier links keep working until they expire, so the newest email is the one to use.",
  },
  link_used: {
    title: "Link Already Used",
    description:
      "This link was already opened, often by an email security scanner that checks links before you see them. The 6-digit code in the same email still works.",
  },
  not_allowed: {
    title: "No Account for This Address",
    description: "This server only signs in existing accounts. Ask the person who runs it to add your address.",
  },
  rate_limited: {
    title: "Too Many Attempts",
    description: "Please wait a few minutes before trying again.",
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
  const email = searchParams.get("email") || "";
  const loginHref = email ? `/auth/login?${new URLSearchParams({ email })}` : "/auth/login";
  // A used-up link leaves its code working; an expired one takes the code with it.
  const codeHref = reason === "link_used" ? `/auth/login?${new URLSearchParams({ email, step: "code" })}` : null;

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
          <AlertCircle className="h-6 w-6 text-destructive" />
        </div>
        <CardTitle>{error.title}</CardTitle>
        <CardDescription>{error.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {codeHref && (
          <Button asChild className="min-h-11">
            <Link href={codeHref}>Enter the code from the email</Link>
          </Button>
        )}
        <Button asChild variant={codeHref ? "outline" : "default"} className="min-h-11">
          <Link href={loginHref}>{codeHref ? "Send a new email" : "Try Again"}</Link>
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
