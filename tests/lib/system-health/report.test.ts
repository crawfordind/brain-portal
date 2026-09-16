import { describe, it, expect } from "vitest";
import { formatAdminReport, type SystemHealth } from "@/lib/system-health/types";
import { diagnoseError, diagnosisFor } from "@/lib/system-health/diagnose";

function health(overrides: Partial<SystemHealth> = {}): SystemHealth {
  return {
    status: "down",
    issueCount: 1,
    errorCount: 1,
    warningCount: 0,
    checkedAt: "2026-08-20T12:00:00.000Z",
    summary: "AI provider key is not configured",
    issues: [
      {
        signature: "config:AI_KEY_MISSING",
        kind: "configuration",
        subsystem: "Server configuration",
        subject: "No AI provider key is set on the server",
        diagnosis: diagnosisFor("AI_KEY_MISSING"),
        rawError: "",
        occurredAt: "2026-08-20T12:00:00.000Z",
        count: 1,
      },
    ],
    ...overrides,
  };
}

describe("formatAdminReport", () => {
  it("carries everything an admin needs to act without the app in front of them", () => {
    const report = formatAdminReport(health());

    expect(report).toContain("AI_KEY_MISSING");
    expect(report).toContain("OPENROUTER_API_KEY");
    expect(report).toContain("2026-08-20T12:00:00.000Z");
    expect(report).toContain("Server configuration");
  });

  it("includes the raw error when one exists", () => {
    const withRaw = health({
      issues: [
        {
          signature: "agent_task:AI_RATE_LIMITED:x",
          kind: "agent_task",
          subsystem: "AI delegation",
          subject: '3 agent tasks failed, including "Draft the brief"',
          diagnosis: diagnoseError("429 Rate limit exceeded"),
          rawError: "429 Rate limit exceeded",
          occurredAt: "2026-08-20 11:00:00",
          count: 3,
        },
      ],
    });

    expect(formatAdminReport(withRaw)).toContain("Raw error: 429 Rate limit exceeded");
    expect(formatAdminReport(withRaw)).toContain("Occurrences: 3");
  });

  it("says so plainly when nothing is wrong", () => {
    const ok = health({
      status: "ok",
      issueCount: 0,
      errorCount: 0,
      warningCount: 0,
      issues: [],
    });

    expect(formatAdminReport(ok)).toContain("No issues detected.");
  });

  it("stamps a version when one is supplied", () => {
    expect(formatAdminReport(health(), "0.1.0")).toContain("Version: 0.1.0");
    expect(formatAdminReport(health())).not.toContain("Version:");
  });
});
