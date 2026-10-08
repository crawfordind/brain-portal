import { describe, it, expect } from "vitest";
import {
  JACK_STATES,
  JACK_STATE_LABELS,
  coarseStatus,
  interpretRunStatus,
  isApprovalChoice,
  parsePendingApproval,
  redactJackText,
  sessionIdForTask,
} from "@/lib/agents/jack/types";
import { redactSecrets } from "@/lib/system-health/diagnose";

const CHECK = ["queued", "processing", "awaiting_review", "revision_requested", "approved", "rejected", "failed"];

describe("coarseStatus", () => {
  it("always lands inside the legacy status CHECK constraint", () => {
    for (const state of JACK_STATES) {
      expect(CHECK).toContain(coarseStatus(state, 0));
      expect(CHECK).toContain(coarseStatus(state, 2));
    }
  });

  it("reports work Jack may be doing as processing", () => {
    for (const s of ["dispatching", "running", "awaiting_approval", "awaiting_input", "cancelling"] as const) {
      expect(coarseStatus(s, 0)).toBe("processing");
    }
  });

  it("keeps an earlier version reviewable when a later attempt fails or is cancelled", () => {
    expect(coarseStatus("failed", 0)).toBe("failed");
    expect(coarseStatus("failed", 1)).toBe("awaiting_review");
    expect(coarseStatus("cancelled", 0)).toBe("rejected");
    expect(coarseStatus("cancelled", 1)).toBe("awaiting_review");
    expect(coarseStatus("queued", 1)).toBe("revision_requested");
  });

  it("has a label for every state", () => {
    for (const s of JACK_STATES) expect(JACK_STATE_LABELS[s]).toBeTruthy();
  });
});

describe("interpretRunStatus (Hermes → Brain Portal)", () => {
  it.each([
    ["queued", "running"],
    ["running", "running"],
    ["waiting_for_approval", "awaiting_approval"],
    ["stopping", "cancelling"],
  ])("%s is in progress as %s", (status, state) => {
    expect(interpretRunStatus(status, null, null)).toEqual({ kind: "in_progress", state });
  });

  it("completed with text is an output; completed with nothing is a failure", () => {
    expect(interpretRunStatus("completed", "  Done.  ", null)).toEqual({ kind: "completed", output: "Done." });
    expect(interpretRunStatus("completed", "", null).kind).toBe("failed");
    expect(interpretRunStatus("completed", { not: "text" }, null).kind).toBe("failed");
  });

  it("explains failures without echoing provider text", () => {
    const out = interpretRunStatus("failed", null, "max_iterations_reached(60/60) at /home/daniel/.hermes");
    expect(out).toMatchObject({ kind: "failed", runState: "failed" });
    expect(JSON.stringify(out)).not.toContain("/home/daniel");
  });

  it("an interrupted run is a failure that warns about partial work", () => {
    const out = interpretRunStatus("interrupted", null, "Gateway shutdown interrupted the run.");
    expect(out).toMatchObject({ kind: "failed", runState: "interrupted" });
    expect(JSON.stringify(out)).toMatch(/part of the work/);
  });

  it("cancelled and unknown statuses", () => {
    expect(interpretRunStatus("cancelled", null, null)).toEqual({ kind: "cancelled" });
    expect(interpretRunStatus("teleported", null, null)).toEqual({ kind: "unknown", status: "teleported" });
  });
});

describe("approvals", () => {
  it("only ever offers once and deny", () => {
    expect(isApprovalChoice("once")).toBe(true);
    expect(isApprovalChoice("deny")).toBe(true);
    expect(isApprovalChoice("session")).toBe(false);
    expect(isApprovalChoice("always")).toBe(false);
    expect(isApprovalChoice("approve")).toBe(false);
  });

  it("keeps an allowlist of display fields and redacts secrets", () => {
    const parsed = parsePendingApproval(
      {
        request_id: "r1",
        command: "curl -H 'Authorization: Bearer sk-or-v1-abcdefghijklmnopqrstuv' https://x",
        description: "Fetch a page",
        tool_name: "terminal",
        arguments: { password: "hunter2" },
        smart_denied: false,
      },
      redactSecrets
    );
    expect(parsed).toEqual({
      requestId: "r1",
      command: expect.not.stringContaining("abcdefghijklmnop"),
      description: "Fetch a page",
      tool: "terminal",
    });
    expect(JSON.stringify(parsed)).not.toContain("hunter2");
  });

  it("clips oversized fields and ignores junk", () => {
    const parsed = parsePendingApproval({ command: "x".repeat(5000) });
    expect(parsed!.command!.length).toBeLessThanOrEqual(1001);
    expect(parsePendingApproval(null)).toBeNull();
    expect(parsePendingApproval("nope")).toBeNull();
    expect(parsePendingApproval({})).toBeNull();
  });
});

it("gives every task its own Hermes session", () => {
  expect(sessionIdForTask("abc")).toBe("brain-portal-task-abc");
});

describe("redactJackText", () => {
  it("removes the secrets Brain Portal holds for Jack, wherever they appear", () => {
    expect(redactJackText("curl -u x:SUPERSECRETKEY123 host", ["SUPERSECRETKEY123"])).not.toContain("SUPERSECRETKEY123");
  });

  it.each([
    "deploy --token abc123def456",
    "deploy --api-key=abc123def456",
    "export PASSWORD=abc123def456",
    '{"client_secret": "abc123def456"}',
    "login password: 'abc123def456'",
    "https://x.test/?token=abc123def456&page=2",
  ])("redacts %s", (text) => {
    const out = redactJackText(text);
    expect(out).not.toContain("abc123def456");
    expect(out).toContain("[redacted]");
  });

  it("leaves ordinary commands readable", () => {
    expect(redactJackText("update_task --id t9 --status done")).toBe("update_task --id t9 --status done");
  });
});
