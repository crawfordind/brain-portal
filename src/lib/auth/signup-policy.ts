/**
 * Who is allowed to become a user on this deployment.
 *
 * Magic-link auth creates an account for any address that successfully
 * verifies, which means an instance with SMTP configured and no policy is an
 * open signup: anyone on the internet who can receive mail gets a workspace,
 * an AI budget funded by the operator's OpenRouter key, and a share of the
 * database. That is almost never what someone self-hosting a personal
 * knowledge base wants, so the default is closed.
 *
 * Policy is chosen by env var:
 *
 *   SIGNUP_MODE=closed   (default) — only addresses already in `users` can
 *                        sign in. The first account is created by the operator
 *                        with `npm run user:create`, or by temporarily setting
 *                        one of the modes below.
 *   SIGNUP_MODE=allowlist — ALLOWED_EMAILS (comma-separated) may sign up.
 *                        Entries may be a full address (`a@b.com`) or a domain
 *                        (`@b.com`) to admit everyone at that domain.
 *   SIGNUP_MODE=open     — anyone may sign up. Only sensible for a deployment
 *                        that is deliberately a public service.
 *
 * Existing users can always sign in regardless of mode; the policy gates
 * account *creation*, not login.
 */

export type SignupMode = "closed" | "allowlist" | "open";

export function getSignupMode(): SignupMode {
  const raw = process.env.SIGNUP_MODE?.trim().toLowerCase();
  if (raw === "open" || raw === "allowlist") return raw;
  return "closed";
}

function getAllowedEntries(): string[] {
  return (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * May `email` have an account created for it?
 *
 * Callers must still treat an existing user as permitted — see the module note.
 */
export function mayCreateAccount(email: string): boolean {
  const mode = getSignupMode();
  if (mode === "open") return true;
  if (mode === "closed") return false;

  const normalized = email.trim().toLowerCase();
  const domain = normalized.slice(normalized.lastIndexOf("@"));

  return getAllowedEntries().some(
    (entry) => entry === normalized || (entry.startsWith("@") && entry === domain)
  );
}

/**
 * Human-readable reason a signup was refused, for logs and the login page.
 */
export function signupRefusalReason(): string {
  const mode = getSignupMode();
  if (mode === "allowlist") {
    return "This address is not on the allowlist for this instance.";
  }
  return "This instance is not accepting new accounts.";
}
