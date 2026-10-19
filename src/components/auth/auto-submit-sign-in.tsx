"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { Loader2, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AutoSubmitSignInProps {
  token: string;
  email: string;
  invite?: string;
  /**
   * Post as soon as the page renders. Only for the browser that asked for the
   * email: mail scanners run scripts too, so for anyone else it takes a press.
   */
  auto: boolean;
}

/**
 * The form that actually uses a sign-in link. Without JavaScript the button
 * is there either way.
 */
export function AutoSubmitSignIn({ token, email, invite, auto }: AutoSubmitSignInProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const submitted = useRef(false);

  useEffect(() => {
    // Strict Mode runs effects twice in development; one link, one submit.
    if (!auto || submitted.current || !formRef.current) return;
    submitted.current = true;
    const form = formRef.current;
    if (typeof form.requestSubmit === "function") form.requestSubmit();
    else form.submit();
  }, [auto]);

  const codeHref = `/auth/login?${new URLSearchParams({ email, step: "code" })}`;

  return (
    <form ref={formRef} method="post" action="/api/auth/verify" className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="email" value={email} />
      {invite && <input type="hidden" name="invite" value={invite} />}
      {auto && (
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Signing you in…
        </div>
      )}
      <Button type="submit" variant={auto ? "outline" : "default"} className="w-full min-h-11">
        <LogIn className="mr-2 h-4 w-4" aria-hidden="true" />
        {auto ? "Continue to Brain Portal" : "Sign in"}
      </Button>
      {!auto && (
        <p className="text-xs text-muted-foreground text-center">
          Asked for this email on another device? You can sign in here, or type the 6-digit code
          from the email{" "}
          <Link href={codeHref} className="text-primary hover:underline">
            on the sign-in screen
          </Link>
          .
        </p>
      )}
    </form>
  );
}
