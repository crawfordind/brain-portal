import { describe, it, expect } from "vitest";
import {
  diagnoseError,
  diagnosisFor,
  redactSecrets,
  type DiagnosisCode,
} from "@/lib/system-health/diagnose";

/**
 * These strings are the shapes that actually land in `agent_tasks.last_error`.
 * The point of the module is that a user reading the panel learns something,
 * so each case asserts the classification a human would make.
 */
const REAL_ERRORS: [string, DiagnosisCode][] = [
  ["401 No auth credentials found", "AI_KEY_MISSING"],
  ["OPENROUTER_API_KEY is not set", "AI_KEY_MISSING"],
  ["401 Unauthorized", "AI_KEY_INVALID"],
  ["402 Insufficient credits. Add more using https://openrouter.ai/credits", "AI_QUOTA_EXHAUSTED"],
  ["429 Rate limit exceeded: free-models-per-day", "AI_RATE_LIMITED"],
  ["404 No endpoints found for x-ai/grok-4.1-fast", "AI_MODEL_UNAVAILABLE"],
  // Verbatim from src/lib/agents/executor.ts — if that message is reworded,
  // this test is the thing that notices the diagnosis stopped matching.
  ["Agent config not found for legal", "AGENT_NOT_CONFIGURED"],
  // Also verbatim from the executor.
  [
    "Model x-ai/grok-4.1-fast returned an empty response (finish_reason: length)",
    "AI_EMPTY_RESPONSE",
  ],
  ["Request timed out after 60000ms", "AI_TIMEOUT"],
  ["fetch failed", "NETWORK_ERROR"],
  ["ECONNRESET", "NETWORK_ERROR"],
  ["SQLITE_CONSTRAINT: UNIQUE constraint failed: agent_task_outputs.version_number", "DATABASE_ERROR"],
  ["502 Bad Gateway", "AI_UPSTREAM_ERROR"],
];

describe("diagnoseError", () => {
  it.each(REAL_ERRORS)("classifies %j", (raw, expected) => {
    expect(diagnoseError(raw).code).toBe(expected);
  });

  it("falls back to UNKNOWN_ERROR rather than throwing", () => {
    expect(diagnoseError(null).code).toBe("UNKNOWN_ERROR");
    expect(diagnoseError(undefined).code).toBe("UNKNOWN_ERROR");
    expect(diagnoseError("").code).toBe("UNKNOWN_ERROR");
    expect(diagnoseError("something nobody anticipated").code).toBe("UNKNOWN_ERROR");
  });

  it("prefers the specific billing diagnosis over the generic rate limit", () => {
    // A 402 body often mentions quota; billing is the actionable reading.
    expect(diagnoseError("402 quota exceeded, insufficient credits").code).toBe(
      "AI_QUOTA_EXHAUSTED"
    );
  });

  it("marks provider-side blips as retryable and config faults as not", () => {
    expect(diagnoseError("429 rate limit").userRetryable).toBe(true);
    expect(diagnoseError("502 Bad Gateway").userRetryable).toBe(true);
    expect(diagnoseError("401 No auth credentials found").userRetryable).toBe(false);
    expect(diagnoseError("402 Insufficient credits").userRetryable).toBe(false);
  });

  it("always gives the user something to pass on to an admin", () => {
    for (const [raw] of REAL_ERRORS) {
      const d = diagnoseError(raw);
      expect(d.title.length).toBeGreaterThan(0);
      expect(d.explanation.length).toBeGreaterThan(0);
      expect(d.adminHint.length).toBeGreaterThan(0);
    }
  });

  it("never leaks the raw provider string into the explanation", () => {
    const d = diagnoseError("401 No auth credentials found (key sk-or-v1-abc)");
    expect(d.explanation).not.toContain("sk-or-v1");
  });
});

describe("diagnosisFor", () => {
  it("returns the catalog entry for an inferred problem", () => {
    const d = diagnosisFor("WORKER_NOT_RUNNING");
    expect(d.code).toBe("WORKER_NOT_RUNNING");
    expect(d.severity).toBe("error");
    expect(d.adminHint).toMatch(/CRON_SECRET/);
  });
});

describe("redactSecrets", () => {
  it("strips provider and app keys", () => {
    expect(redactSecrets("bad key sk-or-v1-9f8e7d6c5b4a3210")).toBe(
      "bad key sk-or-v1-[redacted]"
    );
    expect(redactSecrets("Authorization: Bearer bp_mcp_abcdef1234567890")).toContain(
      "[redacted]"
    );
    expect(redactSecrets("Authorization: Bearer bp_mcp_abcdef1234567890")).not.toContain(
      "abcdef1234567890"
    );
  });

  it("leaves ordinary error text alone", () => {
    expect(redactSecrets("429 Rate limit exceeded")).toBe("429 Rate limit exceeded");
  });

  it("caps runaway error bodies", () => {
    expect(redactSecrets("x".repeat(5000)).length).toBe(1000);
  });

  it("handles empty input", () => {
    expect(redactSecrets(null)).toBe("");
    expect(redactSecrets(undefined)).toBe("");
  });
});
