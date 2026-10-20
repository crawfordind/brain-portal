/**
 * Which failures are worth another attempt, and where.
 *
 * Three different answers, kept together so they cannot drift apart:
 * - retry the same model (a transient blip),
 * - try the next model on the same provider (that model is gone),
 * - try the next provider (this one can't serve the request right now).
 */

import { ClaudeRefusalError } from "./anthropic";
import { ChatGptAuthError } from "./chatgpt/oauth";
import { ChatGptPlanError } from "./chatgpt/responses";
import { AiCredentialError } from "./credentials/resolve";

// Upstream conditions worth retrying: rate limits, gateway hiccups, dropped
// sockets. Anything else (bad model id, auth, malformed request) fails fast —
// retrying those just burns the caller's time budget.
const TRANSIENT_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const TRANSIENT_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "EAI_AGAIN",
]);

export function isTransientError(error: unknown): boolean {
  const status = (error as { status?: number } | null)?.status;
  if (typeof status === "number") return TRANSIENT_STATUS_CODES.has(status);

  const code = (error as { code?: string } | null)?.code;
  if (typeof code === "string" && TRANSIENT_ERROR_CODES.has(code)) return true;

  return error instanceof Error && /timeout|socket hang up|fetch failed/i.test(error.message);
}

/**
 * Does this error mean "that model is gone", as opposed to "that request was
 * bad"?
 *
 * This is the trigger for hopping to the next model in the chain, so it is
 * deliberately keyed on the provider's *message* rather than on HTTP 400
 * alone — a 400 is also what you get for a malformed request, and retrying
 * that against every model in the chain would just be four identical failures.
 */
export function isModelUnavailableError(error: unknown): boolean {
  const status = (error as { status?: number } | null)?.status;
  if (status === 404) return true;

  const message = error instanceof Error ? error.message : String(error ?? "");

  // Phrases only, never a bare "unavailable": this app wraps envelope errors as
  // "Upstream model error: <provider text>", so a loose pattern anchored on the
  // word "model" matches things like "provider unavailable" — a transient
  // outage — and would wrongly abandon a perfectly good model.
  return /not a valid model|no endpoints found|no allowed providers|unknown model|no such model|model not found|does not exist|is not available|no longer available|deprecat|decommission|sunset|retired/i.test(
    message
  );
}


/**
 * Should the next provider get a turn? Yes when this one can't serve the
 * request right now: its key or sign-in was refused, it is out of credit or
 * plan usage, it is rate limited or down, or none of its models exist. No
 * for a malformed request or a refusal, which every provider would repeat.
 */
export function shouldFallBack(error: unknown): boolean {
  if (error instanceof ChatGptPlanError) return error.fallback;
  if (error instanceof ChatGptAuthError || error instanceof AiCredentialError) return true;
  if (error instanceof ClaudeRefusalError) return false;
  const status = (error as { status?: number } | null)?.status;
  if (typeof status === "number") {
    return status === 401 || status === 402 || status === 403 || status === 404 || status === 408 || status === 429 || status >= 500;
  }
  return isTransientError(error) || isModelUnavailableError(error);
}
