/**
 * Server-to-server client for Jack's Hermes API server (Runs API).
 *
 * Only route handlers and the cron import this. It holds the bearer key, so it
 * must never be reachable from a client component; nothing it returns carries
 * the key, the base URL or a raw upstream body.
 *
 * Endpoints (verified against Hermes `gateway/platforms/api_server_runs.py`):
 *   POST /v1/runs                  submit; `Idempotency-Key` makes retries safe
 *   GET  /v1/runs/{id}             poll status, output, pending approval
 *   POST /v1/runs/{id}/approval    { choice, request_id }
 *   POST /v1/runs/{id}/stop        cooperative stop
 *   GET  /v1/capabilities          connection test
 */

import type { JackConfig } from "./config";

export type JackErrorKind =
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
export class JackError extends Error {
  constructor(
    readonly kind: JackErrorKind,
    message: string,
    readonly status: number | null = null,
    /** Hermes's machine-readable error code, when it sent one. */
    readonly code: string | null = null
  ) {
    super(message);
    this.name = "JackError";
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

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export interface HermesRun {
  run_id: string;
  status: string;
  session_id?: string;
  output?: unknown;
  error?: unknown;
  approval?: unknown;
  usage?: { input_tokens?: number; output_tokens?: number } | null;
  runtime?: { provider?: string; model?: string } | null;
}

export interface CreateRunBody {
  input: string;
  instructions: string;
  session_id: string;
}

export interface JackClient {
  createRun(body: CreateRunBody, idempotencyKey: string): Promise<{ runId: string; replayed: boolean }>;
  getRun(runId: string): Promise<HermesRun>;
  stopRun(runId: string): Promise<void>;
  resolveApproval(runId: string, choice: "once" | "deny", requestId: string | null): Promise<void>;
  capabilities(): Promise<{ model: string | null; features: Record<string, unknown> }>;
}

type FetchLike = typeof fetch;

export function createJackClient(
  config: JackConfig,
  options: { fetchImpl?: FetchLike; timeoutMs?: number } = {}
): JackClient {
  if (config.state !== "ready") {
    throw new JackError("bad_request", config.reason ?? "Jack connection not configured.");
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function call(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {}
  ): Promise<{ status: number; json: Record<string, unknown>; headers: Headers }> {
    let res: Response;
    try {
      res = await fetchImpl(`${config.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...config.edgeHeaders,
          ...extraHeaders,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        // A redirect would carry the bearer key to wherever it points.
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      if (name === "TimeoutError" || name === "AbortError") {
        throw new JackError("timeout", `Jack did not answer within ${Math.round(timeoutMs / 1000)}s.`);
      }
      throw new JackError("unreachable", "Jack could not be reached.");
    }

    const json = await readJson(res);
    if (res.ok) return { status: res.status, json, headers: res.headers };

    const code = extractCode(json);
    throw classifyStatus(res.status, code);
  }

  return {
    async createRun(body, idempotencyKey) {
      const { json, headers } = await call("POST", "/v1/runs", body, {
        "Idempotency-Key": idempotencyKey,
      });
      const runId = typeof json.run_id === "string" ? json.run_id : "";
      if (!runId) throw new JackError("bad_response", "Jack accepted the task but returned no run id.");
      return { runId, replayed: headers.get("Idempotency-Replayed") === "true" };
    },

    async getRun(runId) {
      const { json } = await call("GET", `/v1/runs/${encodeURIComponent(runId)}`);
      if (typeof json.status !== "string") {
        throw new JackError("bad_response", "Jack returned a run without a status.");
      }
      return { ...json, run_id: runId } as unknown as HermesRun;
    },

    async stopRun(runId) {
      await call("POST", `/v1/runs/${encodeURIComponent(runId)}/stop`, {});
    },

    async resolveApproval(runId, choice, requestId) {
      await call("POST", `/v1/runs/${encodeURIComponent(runId)}/approval`, {
        choice,
        ...(requestId ? { request_id: requestId } : {}),
      });
    },

    async capabilities() {
      const { json } = await call("GET", "/v1/capabilities");
      return {
        model: typeof json.model === "string" ? json.model : null,
        features: (json.features && typeof json.features === "object"
          ? json.features
          : {}) as Record<string, unknown>,
      };
    },
  };
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > MAX_RESPONSE_BYTES) {
    throw new JackError("bad_response", "Jack's response was too large.");
  }
  let text: string;
  try {
    text = await res.text();
  } catch {
    throw new JackError("unreachable", "The connection to Jack dropped mid-response.");
  }
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new JackError("bad_response", "Jack's response was too large.");
  }
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    // An HTML error page from a proxy in front of Hermes, typically.
    if (res.ok) throw new JackError("bad_response", "Jack returned something that was not JSON.");
    return {};
  }
}

/** Hermes errors are OpenAI-shaped: `{ error: { message, code } }`. Only the code is kept. */
function extractCode(json: Record<string, unknown>): string | null {
  const err = json.error;
  if (err && typeof err === "object") {
    const code = (err as Record<string, unknown>).code;
    if (typeof code === "string" && /^[a-z0-9_]{1,64}$/i.test(code)) return code;
  }
  return null;
}

function classifyStatus(status: number, code: string | null): JackError {
  if (status === 401 || status === 403) {
    return new JackError(
      "auth",
      "Jack rejected Brain Portal's credentials. Check JACK_HERMES_API_KEY (and the edge token, if one is set).",
      status,
      code
    );
  }
  if (status === 404) return new JackError("not_found", "Jack has no record of that run.", status, code);
  if (status === 409) {
    return new JackError("conflict", conflictMessage(code), status, code);
  }
  if (status === 429) {
    return new JackError("rate_limited", "Jack is at its concurrent-run limit. It will be retried.", status, code);
  }
  if (status >= 500) return new JackError("server", `Jack's server returned an error (${status}).`, status, code);
  return new JackError("bad_request", `Jack refused the request (${status}${code ? `, ${code}` : ""}).`, status, code);
}

function conflictMessage(code: string | null): string {
  switch (code) {
    case "approval_not_pending":
    case "approval_not_active":
      return "That approval has already been resolved or expired.";
    case "idempotency_key_conflict":
      return "Jack saw this submission before with different content.";
    default:
      return "Jack reported a conflict with the run's current state.";
  }
}
