"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Brain, Mail, Loader2, ExternalLink, RotateCw, LogIn } from "lucide-react";

/** Seconds before "Send another code" is offered: long enough for most mail to land. */
const RESEND_COOLDOWN_SECONDS = 30;

/** Where to land after signing in: the page the middleware bounced here from. */
function redirectTarget(): string {
  if (typeof window === "undefined") return "/";
  return new URLSearchParams(window.location.search).get("redirect") || "/";
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");
  const [devLink, setDevLink] = useState("");
  const [devCode, setDevCode] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [resent, setResent] = useState(false);
  // Assume a code was sent unless the server says the database cannot store
  // one. Unknown addresses get the same response as known ones, so they also
  // see the code box; that is deliberate (no account enumeration).
  const [hasCode, setHasCode] = useState(true);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);

  // `?email=…&step=code` (from a link a scanner used up, or the landing
  // page): straight to typing the code from the email already received.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromLink = params.get("email");
    if (fromLink) setEmail(fromLink);
    if (fromLink && params.get("step") === "code") setSuccess(true);
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await sendLink();
  };

  const sendLink = async (isResend = false) => {
    setIsLoading(true);
    setError("");
    setDevLink("");
    setDevCode("");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to send login email");
      }

      setSuccess(true);
      setResent(isResend);
      setCooldown(RESEND_COOLDOWN_SECONDS);
      setHasCode(data.hasCode !== false);
      setCodeError("");

      // In development, show the magic link and code
      if (data.magicLink) {
        setDevLink(data.magicLink);
      }
      if (data.code) {
        setDevCode(data.code);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setIsLoading(false);
    }
  };

  const verifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsVerifying(true);
    setCodeError("");

    try {
      const response = await fetch("/api/auth/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code, redirect: redirectTarget() }),
      });
      const data = await response.json();

      if (!response.ok) {
        const left =
          data.reason === "wrong_code" && typeof data.attemptsLeft === "number"
            ? ` ${data.attemptsLeft} ${data.attemptsLeft === 1 ? "try" : "tries"} left.`
            : "";
        throw new Error(`${data.error || "That code didn't work."}${left}`);
      }

      // A full navigation, so the new session cookie is sent with every
      // request from here on and the app loads signed in.
      window.location.assign(data.redirect || "/");
    } catch (err) {
      setCodeError(err instanceof Error ? err.message : "Something went wrong");
      setIsVerifying(false);
    }
  };

  const digits = code.replace(/\D/g, "");

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Brain className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-2xl">Brain Portal</CardTitle>
          <CardDescription>
            Think clearly. Connect everything.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {success ? (
            <div className="text-center space-y-4">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-900">
                <Mail className="h-6 w-6 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <h3 className="font-medium">Check your email</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {resent ? "We sent another email to" : "We sent an email to"} {email.trim()}
                </p>
              </div>

              {hasCode && (
                <form onSubmit={verifyCode} className="space-y-3 text-left">
                  <label htmlFor="code" className="text-sm font-medium block text-center">
                    Enter the 6-digit code from the email
                  </label>
                  <Input
                    id="code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9 ]*"
                    maxLength={9}
                    placeholder="123 456"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    disabled={isVerifying}
                    className="h-14 text-center text-2xl font-mono tracking-[0.3em]"
                    aria-describedby="code-help"
                  />
                  {codeError && <p className="text-sm text-destructive text-center">{codeError}</p>}
                  <Button type="submit" className="w-full min-h-11" disabled={isVerifying || digits.length !== 6}>
                    {isVerifying ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <LogIn className="mr-2 h-4 w-4" />
                    )}
                    Sign in
                  </Button>
                  <p id="code-help" className="text-xs text-muted-foreground text-center">
                    Reading email on another device? Type the code here. Or tap the
                    link in the email to sign in on the device that has it open.
                  </p>
                </form>
              )}

              <p className="text-xs text-muted-foreground">
                Email can take a few minutes. Check spam too. If you ask for another email, the
                earlier ones keep working, so use whichever arrives first. If the link says it was
                already used (work email often checks links first), type the code instead.
              </p>
              {error && <p className="text-sm text-destructive">{error}</p>}
              {(devLink || devCode) && (
                <div className="mt-4 p-3 bg-muted rounded-lg">
                  <p className="text-xs text-muted-foreground mb-2">
                    Development mode - no email was sent:
                  </p>
                  {devCode && (
                    <p className="font-mono text-lg mb-2" aria-label="Development sign-in code">
                      {devCode}
                    </p>
                  )}
                  {devLink && (
                    <a
                      href={devLink}
                      className="text-sm text-primary hover:underline flex items-center justify-center gap-1"
                    >
                      Sign in now <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              )}
              <div className="flex flex-col gap-2 pt-2">
                <Button
                  variant="outline"
                  className="min-h-11"
                  disabled={isLoading || cooldown > 0}
                  onClick={() => sendLink(true)}
                >
                  {isLoading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RotateCw className="mr-2 h-4 w-4" />
                  )}
                  {cooldown > 0 ? `Send another email (${cooldown}s)` : "Send another email"}
                </Button>
                <Button
                  variant="ghost"
                  className="min-h-11"
                  onClick={() => {
                    setSuccess(false);
                    setEmail("");
                    setError("");
                    setCode("");
                    setCodeError("");
                    setCooldown(0);
                  }}
                >
                  Use a different email
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="email" className="text-sm font-medium">
                  Email address
                </label>
                <Input
                  id="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={isLoading}
                />
              </div>
              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Mail className="mr-2 h-4 w-4" />
                    Continue with Email
                  </>
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full min-h-11"
                disabled={isLoading || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())}
                onClick={() => {
                  setError("");
                  setSuccess(true);
                }}
              >
                I already have a code
              </Button>
              <p className="text-xs text-center text-muted-foreground">
                We&apos;ll email you a sign-in code and link.
                <br />
                No password needed.
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
