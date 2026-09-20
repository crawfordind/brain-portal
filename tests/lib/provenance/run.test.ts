import { describe, it, expect } from "vitest";
import {
  createRunTracker,
  continuesRun,
  DEFAULT_RUN_GAP_MS,
  DEFAULT_MAX_RUN_MS,
} from "@/lib/provenance/run";
import { mcpKeyStamp } from "@/lib/provenance";
import { normalizeActor, readStamp, stampValues } from "@/lib/provenance/types";

/** A counting generator, so a run id in an assertion is readable. */
function counter() {
  let n = 0;
  return () => `run_${++n}`;
}

const MIN = 60_000;
const T0 = 1_700_000_000_000;

describe("continuesRun", () => {
  const state = { runId: "run_1", startedAt: T0, lastWriteAt: T0 };

  it("continues while the gap is under the window", () => {
    expect(continuesRun(state, T0 + 29 * MIN, 30 * MIN, DEFAULT_MAX_RUN_MS)).toBe(
      true
    );
  });

  it("breaks once the gap exceeds the window", () => {
    expect(continuesRun(state, T0 + 31 * MIN, 30 * MIN, DEFAULT_MAX_RUN_MS)).toBe(
      false
    );
  });

  it("breaks once the run outlives the ceiling, however busy it is", () => {
    const busy = { runId: "run_1", startedAt: T0, lastWriteAt: T0 + 7 * 3600_000 };
    expect(continuesRun(busy, T0 + 7 * 3600_000, 30 * MIN, 6 * 3600_000)).toBe(
      false
    );
  });
});

describe("createRunTracker", () => {
  it("gives consecutive writes from one key the same run", () => {
    const tracker = createRunTracker({ generateId: counter() });

    expect(tracker.runFor("key-a", T0)).toBe("run_1");
    expect(tracker.runFor("key-a", T0 + 5 * MIN)).toBe("run_1");
    expect(tracker.runFor("key-a", T0 + 9 * MIN)).toBe("run_1");
  });

  it("starts a new run once the key goes quiet for longer than the gap", () => {
    const tracker = createRunTracker({ gapMs: 30 * MIN, generateId: counter() });

    expect(tracker.runFor("key-a", T0)).toBe("run_1");
    expect(tracker.runFor("key-a", T0 + 31 * MIN)).toBe("run_2");
  });

  it("keeps a long steady job as one run — the window slides", () => {
    // This is the case the whole feature exists for: a job that writes for
    // hours is one job. A fixed window from the first write would chop it into
    // arbitrary pieces and show the user four collapsed rows for one task.
    const tracker = createRunTracker({ gapMs: 30 * MIN, generateId: counter() });

    let last = "";
    for (let minute = 0; minute <= 240; minute += 20) {
      last = tracker.runFor("key-a", T0 + minute * MIN);
    }
    expect(last).toBe("run_1");
  });

  it("rolls over once a run outlives the ceiling", () => {
    const tracker = createRunTracker({
      gapMs: 30 * MIN,
      maxRunMs: 60 * MIN,
      generateId: counter(),
    });

    expect(tracker.runFor("key-a", T0)).toBe("run_1");
    expect(tracker.runFor("key-a", T0 + 30 * MIN)).toBe("run_1");
    expect(tracker.runFor("key-a", T0 + 61 * MIN)).toBe("run_2");
  });

  it("keeps keys apart — two agents writing at once are two runs", () => {
    const tracker = createRunTracker({ generateId: counter() });

    expect(tracker.runFor("key-a", T0)).toBe("run_1");
    expect(tracker.runFor("key-b", T0)).toBe("run_2");
    expect(tracker.runFor("key-a", T0 + MIN)).toBe("run_1");
    expect(tracker.runFor("key-b", T0 + MIN)).toBe("run_2");
  });

  it("adopts a client-supplied run id and keeps using it", () => {
    // A client that sends X-Brain-Run-Id once should not have every later
    // write in the same job fall back to a server-derived run.
    const tracker = createRunTracker({ generateId: counter() });

    expect(tracker.adopt("key-a", "client-run", T0)).toBe("client-run");
    expect(tracker.runFor("key-a", T0 + 5 * MIN)).toBe("client-run");
  });

  it("switches runs when the client supplies a different id", () => {
    const tracker = createRunTracker({ generateId: counter() });

    tracker.adopt("key-a", "job-1", T0);
    expect(tracker.adopt("key-a", "job-2", T0 + MIN)).toBe("job-2");
    expect(tracker.runFor("key-a", T0 + 2 * MIN)).toBe("job-2");
  });

  it("resets", () => {
    const tracker = createRunTracker({ generateId: counter() });
    tracker.runFor("key-a", T0);
    expect(tracker.size()).toBe(1);
    tracker.reset();
    expect(tracker.size()).toBe(0);
    expect(tracker.peek("key-a")).toBeUndefined();
  });

  it("defaults to a 30-minute gap", () => {
    expect(DEFAULT_RUN_GAP_MS).toBe(30 * MIN);
  });
});

describe("mcpKeyStamp", () => {
  it("stamps a real key as an automated writer", () => {
    const stamp = mcpKeyStamp({ keyId: "key-1", keyName: "Claude Desktop" }, null, T0);

    expect(stamp.actor).toBe("mcp_key");
    expect(stamp.keyId).toBe("key-1");
    expect(stamp.label).toBe("Claude Desktop");
    expect(stamp.runId).toBeTruthy();
  });

  it("reads a session caller as the person, not an agent", () => {
    // The share route authenticates by cookie *or* by key through one handler.
    // An empty key id means the person shared the link themselves, and their
    // own writes must never be collapsed as somebody else's batch.
    const stamp = mcpKeyStamp({ keyId: "", keyName: "" }, null, T0);

    expect(stamp.actor).toBe("human");
    expect(stamp.runId).toBeNull();
  });

  it("treats the MCP_USER_ID dev fallback as the person too", () => {
    const stamp = mcpKeyStamp({ keyId: "dev-fallback", keyName: "dev" }, null, T0);
    expect(stamp.actor).toBe("human");
  });

  it("falls back to a readable label for an unnamed key", () => {
    const stamp = mcpKeyStamp({ keyId: "key-1", keyName: "" }, null, T0);
    expect(stamp.label).toBe("API key");
  });
});

describe("reading stamps back", () => {
  it("reads a row with no provenance as written by the user", () => {
    // Every row predating these columns has NULL in all four. Treating that as
    // 'human' is what makes the migration backfill-free.
    expect(normalizeActor(null)).toBe("human");
    expect(normalizeActor(undefined)).toBe("human");
    expect(normalizeActor("")).toBe("human");
    expect(readStamp({})).toEqual({
      actor: "human",
      keyId: null,
      label: null,
      runId: null,
    });
  });

  it("does not trust an unrecognised actor string from the database", () => {
    expect(normalizeActor("wizard")).toBe("human");
  });

  it("orders insert values to match the column list", () => {
    expect(
      stampValues({ actor: "agent", keyId: "k", label: "l", runId: "r" })
    ).toEqual(["agent", "k", "l", "r"]);
  });
});
