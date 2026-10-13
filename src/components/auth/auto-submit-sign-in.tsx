"use client";

import { useEffect, useRef } from "react";
import { Loader2, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AutoSubmitSignInProps {
  token: string;
  email: string;
  invite?: string;
}

/**
 * The form that actually spends a sign-in link. It posts itself as soon as a
 * real browser renders it; mail scanners fetch the page without running
 * scripts, so they never get this far. Without JavaScript the button is there.
 */
export function AutoSubmitSignIn({ token, email, invite }: AutoSubmitSignInProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const submitted = useRef(false);

  useEffect(() => {
    // Strict Mode runs effects twice in development; one link, one submit.
    if (submitted.current || !formRef.current) return;
    submitted.current = true;
    const form = formRef.current;
    if (typeof form.requestSubmit === "function") form.requestSubmit();
    else form.submit();
  }, []);

  return (
    <form ref={formRef} method="post" action="/api/auth/verify" className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="email" value={email} />
      {invite && <input type="hidden" name="invite" value={invite} />}
      <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Signing you in…
      </div>
      <Button type="submit" variant="outline" className="w-full min-h-11">
        <LogIn className="mr-2 h-4 w-4" aria-hidden="true" />
        Continue to Brain Portal
      </Button>
    </form>
  );
}
