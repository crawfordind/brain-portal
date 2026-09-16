/**
 * Failure Diagnosis — turns raw subsystem errors into something a user can act on.
 *
 * Background work in this app (agent delegation, the embedding queue, heartbeat
 * ticks, skills) fails behind the scenes. The raw text that lands in
 * `agent_tasks.last_error` / `processing_queue.error_message` is provider jargon
 * ("401 No auth credentials found", "429 Rate limit exceeded"). Showing that to
 * the user explains nothing; showing nothing at all — which is what we did
 * before — is worse, because the work just silently never happens.
 *
 * This module is pure and dependency-free so it can be unit tested and used from
 * both server and client code. It maps raw error text to a stable diagnosis
 * code, a plain-language explanation, and a hint the user can pass on to whoever
 * administers the deployment.
 */

/** Stable, reportable identifiers. Safe to quote in a bug report. */
export type DiagnosisCode =
  | "AI_KEY_MISSING"
  | "AI_KEY_INVALID"
  | "AI_QUOTA_EXHAUSTED"
  | "AI_RATE_LIMITED"
  | "AI_MODEL_UNAVAILABLE"
  | "AI_EMPTY_RESPONSE"
  | "AI_TIMEOUT"
  | "AI_UPSTREAM_ERROR"
  | "AGENT_NOT_CONFIGURED"
  | "WORKER_NOT_RUNNING"
  | "STORAGE_UNAVAILABLE"
  | "DATABASE_ERROR"
  | "NETWORK_ERROR"
  | "CONTENT_FILTERED"
  | "UNKNOWN_ERROR";

export type DiagnosisSeverity = "warning" | "error";

export interface Diagnosis {
  code: DiagnosisCode;
  /** Short headline, sentence case, no trailing period. */
  title: string;
  /** What this means for the user, in plain language. */
  explanation: string;
  /** The concrete thing to tell whoever administers the deployment. */
  adminHint: string;
  /** Whether the user can plausibly resolve this themselves by retrying. */
  userRetryable: boolean;
  severity: DiagnosisSeverity;
}

interface Rule {
  code: DiagnosisCode;
  match: RegExp;
}

/**
 * Ordered most-specific-first: "insufficient credits" is a 402 that also
 * mentions "quota", and an invalid key often arrives as a generic 401.
 */
const RULES: Rule[] = [
  { code: "AGENT_NOT_CONFIGURED", match: /agent (config|configuration) not found|no agent_configs|unknown agent type/i },
  { code: "AI_KEY_MISSING", match: /no auth credentials|api key.*(not|missing|unset|undefined)|missing api key|apikey.*required|OPENROUTER_API_KEY/i },
  { code: "AI_KEY_INVALID", match: /\b401\b|unauthorized|invalid api key|authentication (failed|error)|user not found/i },
  { code: "AI_QUOTA_EXHAUSTED", match: /\b402\b|insufficient (credits|funds|balance|quota)|payment required|billing|quota exceeded|out of credits/i },
  { code: "AI_RATE_LIMITED", match: /\b429\b|rate.?limit|too many requests|temporarily rate/i },
  { code: "AI_MODEL_UNAVAILABLE", match: /\b404\b.*model|model (not found|unavailable|is not|does not exist)|no (endpoints|providers) found|no allowed providers/i },
  { code: "CONTENT_FILTERED", match: /content.?filter|flagged|moderation|safety (policy|system)/i },
  { code: "AI_EMPTY_RESPONSE", match: /empty (output|response|completion)|returned no (content|output|text)|no choices/i },
  { code: "AI_TIMEOUT", match: /timed? ?out|timeout|deadline exceeded|abort(ed)? (after|due)/i },
  { code: "STORAGE_UNAVAILABLE", match: /\bS3\b|R2_|bucket|NoSuchBucket|AccessDenied.*storage|upload failed/i },
  { code: "DATABASE_ERROR", match: /SQLITE_|libsql|constraint failed|no such (table|column)|database is locked|UNIQUE constraint/i },
  { code: "NETWORK_ERROR", match: /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|EPIPE|fetch failed|socket hang up|network (error|request failed)|getaddrinfo/i },
  { code: "AI_UPSTREAM_ERROR", match: /\b5\d\d\b|upstream|bad gateway|service unavailable|internal server error|provider (error|returned)/i },
];

const CATALOG: Record<DiagnosisCode, Omit<Diagnosis, "code">> = {
  AI_KEY_MISSING: {
    title: "AI provider key is not configured",
    explanation:
      "The server has no API key for the AI provider, so no agent, insight, or embedding work can run. Nothing you do in the app will fix this.",
    adminHint: "Set OPENROUTER_API_KEY in the deployment environment and redeploy.",
    userRetryable: false,
    severity: "error",
  },
  AI_KEY_INVALID: {
    title: "AI provider rejected the server's key",
    explanation:
      "The AI provider refused the credentials this server is using. Agent work will keep failing until the key is replaced.",
    adminHint:
      "OPENROUTER_API_KEY is invalid, revoked, or expired. Issue a new key at openrouter.ai and update the environment variable.",
    userRetryable: false,
    severity: "error",
  },
  AI_QUOTA_EXHAUSTED: {
    title: "AI account is out of credits",
    explanation:
      "The AI provider accepted the key but refused the request for billing reasons. Agent work is paused until the account is topped up.",
    adminHint: "The OpenRouter account has no remaining credit or its spend limit is reached. Add credit or raise the limit.",
    userRetryable: false,
    severity: "error",
  },
  AI_RATE_LIMITED: {
    title: "AI provider is rate-limiting this server",
    explanation:
      "Too many requests were sent in a short window. This usually clears on its own — retrying in a few minutes normally works.",
    adminHint:
      "Sustained 429s suggest the account tier is too low for current volume, or too many jobs are being started per cron tick.",
    userRetryable: true,
    severity: "warning",
  },
  AI_MODEL_UNAVAILABLE: {
    title: "The configured AI model is unavailable",
    explanation:
      "The server asked for a model the provider will not serve, so the request never ran.",
    adminHint:
      "Check OPENROUTER_MODEL and the model_id column in agent_configs — the model id may be retired, misspelled, or unavailable to this account.",
    userRetryable: false,
    severity: "error",
  },
  AI_EMPTY_RESPONSE: {
    title: "The AI returned an empty response",
    explanation:
      "The model ran but produced no usable text. This is often a transient provider issue and a retry usually succeeds.",
    adminHint:
      "Repeated empty responses usually mean the model spends its whole token budget on hidden reasoning. Raise max tokens or switch the model.",
    userRetryable: true,
    severity: "warning",
  },
  AI_TIMEOUT: {
    title: "The AI request timed out",
    explanation:
      "The model took longer to answer than the server was willing to wait. Retrying often works, especially for shorter inputs.",
    adminHint:
      "Consider a faster model or a longer function timeout if this happens on most long-running agent tasks.",
    userRetryable: true,
    severity: "warning",
  },
  AI_UPSTREAM_ERROR: {
    title: "The AI provider had a server error",
    explanation:
      "The provider failed on its side. Nothing is wrong with your content — a retry usually clears it.",
    adminHint: "Upstream 5xx from OpenRouter. If it persists, check the provider's status page.",
    userRetryable: true,
    severity: "warning",
  },
  AGENT_NOT_CONFIGURED: {
    title: "That AI agent is not set up on this server",
    explanation:
      "The work was routed to a specialist agent that has no configuration in this deployment, so it could never start.",
    adminHint:
      "The agent_configs table is missing a row for this agent type. Run the agent seed/migration scripts (e.g. scripts/migrate-add-new-agents.ts).",
    userRetryable: false,
    severity: "error",
  },
  WORKER_NOT_RUNNING: {
    title: "Background work is not being picked up",
    explanation:
      "Jobs are being created but nothing is finishing them, so they sit in the queue indefinitely. This needs a server-side fix.",
    adminHint:
      "Check the cron runs before assuming they are missing: in the Vercel deployment logs, look at /api/cron/process-queue. If there are no requests, the schedules in vercel.json are not firing. If the requests are there but 401, CRON_SECRET is unset or mismatched. If they are there but 500, the worker itself is erroring — the log line carries the reason.",
    userRetryable: false,
    severity: "error",
  },
  STORAGE_UNAVAILABLE: {
    title: "File storage is unavailable",
    explanation: "The server could not read or write attachment storage, so the upload or processing step failed.",
    adminHint: "Check the S3/R2 credentials, bucket name, and endpoint configuration.",
    userRetryable: true,
    severity: "error",
  },
  DATABASE_ERROR: {
    title: "The database rejected an operation",
    explanation:
      "A write failed at the database level. Your existing data is intact, but this particular job did not complete.",
    adminHint:
      "Check the Turso connection and whether all migrations have been applied (npm run db:migrate).",
    userRetryable: true,
    severity: "error",
  },
  NETWORK_ERROR: {
    title: "The server could not reach an external service",
    explanation: "A network call failed before it got a response. Retrying usually works.",
    adminHint: "Transient outbound network failure. Persistent cases suggest DNS or egress restrictions on the host.",
    userRetryable: true,
    severity: "warning",
  },
  CONTENT_FILTERED: {
    title: "The AI declined to process this content",
    explanation:
      "The provider's safety filter blocked the request. Rewording the source content usually resolves it.",
    adminHint: "Provider-side content filter rejection — not a configuration problem.",
    userRetryable: false,
    severity: "warning",
  },
  UNKNOWN_ERROR: {
    title: "The job failed for an unrecognized reason",
    explanation:
      "Something went wrong that the app does not have a specific explanation for. The raw error is included below — send it to your administrator.",
    adminHint: "No matching diagnosis. Use the raw error text and the server logs for this timestamp.",
    userRetryable: true,
    severity: "error",
  },
};

/**
 * Classify a raw error string into an actionable diagnosis.
 * Never throws; unrecognized or empty input yields UNKNOWN_ERROR.
 */
export function diagnoseError(raw: string | null | undefined): Diagnosis {
  const text = (raw || "").trim();
  if (text) {
    for (const rule of RULES) {
      if (rule.match.test(text)) {
        return { code: rule.code, ...CATALOG[rule.code] };
      }
    }
  }
  return { code: "UNKNOWN_ERROR", ...CATALOG.UNKNOWN_ERROR };
}

/** Look up a diagnosis directly by code, for issues we detect without an error string. */
export function diagnosisFor(code: DiagnosisCode): Diagnosis {
  return { code, ...CATALOG[code] };
}

/**
 * Strip anything key-shaped out of raw error text before it reaches the client.
 * Provider errors occasionally echo the credential that was rejected.
 */
export function redactSecrets(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .replace(/\b(sk-or-v1-|sk-|bp_mcp_|Bearer\s+)[A-Za-z0-9_\-.]{8,}/gi, "$1[redacted]")
    .replace(/\b(eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,})\b/g, "[redacted-token]")
    .slice(0, 1000);
}
