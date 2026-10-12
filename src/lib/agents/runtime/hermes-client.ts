/**
 * Server-to-server client for a Hermes Agent API server (Runs API).
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

import type { HermesConfig } from "./config";
import { RuntimeError } from "./errors";

export { RuntimeError } from "./errors";
export type { RuntimeErrorKind } from "./errors";

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

export interface HermesClient {
  createRun(body: CreateRunBody, idempotencyKey: string): Promise<{ runId: string; replayed: boolean }>;
  getRun(runId: string): Promise<HermesRun>;
  stopRun(runId: string): Promise<void>;
  resolveApproval(runId: string, choice: "once" | "deny", requestId: string | null): Promise<void>;
  capabilities(): Promise<{ model: string | null; features: Record<string, unknown> }>;
}

type FetchLike = typeof fetch;

export function createHermesClient(
  config: HermesConfig,
  options: { fetchImpl?: FetchLike; timeoutMs?: number } = {}
): HermesClient {
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
        throw new RuntimeError("timeout", `The Hermes agent did not answer within ${Math.round(timeoutMs / 1000)}s.`);
      }
      throw new RuntimeError("unreachable", "The Hermes agent could not be reached.");
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
      if (!runId) throw new RuntimeError("bad_response", "The Hermes agent accepted the task but returned no run id.");
      return { runId, replayed: headers.get("Idempotency-Replayed") === "true" };
    },

    async getRun(runId) {
      const { json } = await call("GET", `/v1/runs/${encodeURIComponent(runId)}`);
      if (typeof json.status !== "string") {
        throw new RuntimeError("bad_response", "The Hermes agent returned a run without a status.");
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
    throw new RuntimeError("bad_response", "The Hermes agent's response was too large.");
  }
  let text: string;
  try {
    text = await res.text();
  } catch {
    throw new RuntimeError("unreachable", "The connection to the Hermes agent dropped mid-response.");
  }
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new RuntimeError("bad_response", "The Hermes agent's response was too large.");
  }
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    // An HTML error page from a proxy in front of Hermes, typically.
    if (res.ok) throw new RuntimeError("bad_response", "The Hermes agent returned something that was not JSON.");
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

function classifyStatus(status: number, code: string | null): RuntimeError {
  if (status === 401 || status === 403) {
    return new RuntimeError(
      "auth",
      "The Hermes agent rejected Brain Portal's credentials. Check HERMES_API_KEY (and the edge token, if one is set).",
      status,
      code
    );
  }
  if (status === 404) return new RuntimeError("not_found", "The Hermes agent has no record of that run.", status, code);
  if (status === 409) {
    return new RuntimeError("conflict", conflictMessage(code), status, code);
  }
  if (status === 429) {
    return new RuntimeError("rate_limited", "The Hermes agent is at its concurrent-run limit. It will be retried.", status, code);
  }
  if (status >= 500) return new RuntimeError("server", `The Hermes server returned an error (${status}).`, status, code);
  return new RuntimeError("bad_request", `The Hermes agent refused the request (${status}${code ? `, ${code}` : ""}).`, status, code);
}

function conflictMessage(code: string | null): string {
  switch (code) {
    case "approval_not_pending":
    case "approval_not_active":
      return "That approval has already been resolved or expired.";
    case "idempotency_key_conflict":
      return "The Hermes agent saw this submission before with different content.";
    default:
      return "The Hermes agent reported a conflict with the run's current state.";
  }
}
