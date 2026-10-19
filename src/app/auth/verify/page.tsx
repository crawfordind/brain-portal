import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Brain } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AutoSubmitSignIn } from "@/components/auth/auto-submit-sign-in";
import { SIGN_IN_BROWSER_COOKIE } from "@/lib/auth/magic-link";

// The sign-in token is in this page's URL; never hand it to another origin.
export const metadata: Metadata = {
  title: "Signing in · Brain Portal",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

interface PageProps {
  searchParams: Promise<{ token?: string; email?: string; invite?: string }>;
}

/**
 * Where an emailed sign-in link lands. Rendering this page changes nothing:
 * the link is used only when the browser posts the form below.
 *
 * The form posts itself only in the browser that asked for the email (it has
 * `SIGN_IN_BROWSER_COOKIE`). Corporate mail scanners open links in a real,
 * script-running browser before the recipient does, so a page that posted
 * itself for anyone signed the scanner in. Every other browser gets a button.
 */
export default async function VerifyPage({ searchParams }: PageProps) {
  const { token, email, invite } = await searchParams;
  const requestedHere = Boolean((await cookies()).get(SIGN_IN_BROWSER_COOKIE)?.value);

  if (!token || !email) {
    redirect("/auth/error?reason=missing_params");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Brain className="h-6 w-6 text-primary" aria-hidden="true" />
          </div>
          <CardTitle>{requestedHere ? "Signing in" : "Sign in to Brain Portal"}</CardTitle>
          <CardDescription>{email}</CardDescription>
        </CardHeader>
        <CardContent>
          <AutoSubmitSignIn token={token} email={email} invite={invite} auto={requestedHere} />
        </CardContent>
      </Card>
    </div>
  );
}
