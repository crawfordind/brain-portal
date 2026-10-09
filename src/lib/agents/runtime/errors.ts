/**
 * One error type for every runtime, so the dispatcher decides retry-or-fail
 * the same way whether the work went to OpenRouter or to a Hermes agent.
 * Messages are written to be safe to show and to log: no keys, no URLs.
 */

export type RuntimeErrorKind =
  | "unreachable"
  | "timeout"
  | "auth"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "bad_request"
  | "server"
  | "bad_response";

/** Every failure is reduced to a kind and a sentence safe to show and to log. */
export class RuntimeError extends Error {
  constructor(
    readonly kind: RuntimeErrorKind,
    message: string,
    readonly status: number | null = null,
    /** Hermes's machine-readable error code, when it sent one. */
    readonly code: string | null = null
  ) {
    super(message);
    this.name = "RuntimeError";
  }

  /**
   * True when Hermes certainly did not start work for this request, so a retry
   * with the same idempotency key cannot double anything. A timeout is *not*
   * in this set: the request may have landed. It is still retried, but only
   * ever with the same key and body, which Hermes deduplicates.
   */
  get retryable(): boolean {
    return (
      this.kind === "unreachable" ||
      this.kind === "timeout" ||
      this.kind === "rate_limited" ||
      this.kind === "server"
    );
  }
}
