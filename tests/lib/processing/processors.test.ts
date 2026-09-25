import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runJob, SERVERLESS_OPERATIONS, type QueueJob } from "@/lib/processing/processors";

function job(overrides: Partial<QueueJob> = {}): QueueJob {
  return {
    id: "job-1",
    user_id: "user-1",
    entity_type: "note",
    entity_id: "note-1",
    operation: "generate_summary",
    tier: "fast_llm",
    metadata: null,
    ...overrides,
  };
}

describe("SERVERLESS_OPERATIONS", () => {
  it("only names operations the processing_queue CHECK constraint allows", () => {
    const schema = readFileSync(join(process.cwd(), "src/lib/db/schema.ts"), "utf8");
    const match = schema.match(/operation TEXT NOT NULL CHECK \(operation IN \(([^)]*)\)/);
    expect(match).not.toBeNull();
    const constraint = match![1];

    for (const operation of SERVERLESS_OPERATIONS) {
      expect(constraint).toContain(`'${operation}'`);
    }
  });

  it("excludes attachment media operations, which need CLI-only dependencies", () => {
    const excluded = [
      "extract_metadata",
      "generate_thumbnail",
      "extract_text",
      "generate_description",
    ];
    for (const operation of excluded) {
      expect(SERVERLESS_OPERATIONS).not.toContain(operation);
    }
  });
});

describe("runJob", () => {
  it("rejects an operation it does not handle, rather than silently succeeding", async () => {
    await expect(runJob(job({ operation: "generate_thumbnail" }))).rejects.toThrow(
      /not handled by this worker/
    );
  });

  it("refuses to extract contacts from anything but a note or a capture", async () => {
    await expect(
      runJob(job({ operation: "extract-interactions", entity_type: "task" }))
    ).rejects.toThrow(/Cannot extract contacts from entity type 'task'/);
  });

  it("refuses to scan an entity type the task scanner cannot load", async () => {
    await expect(
      runJob(job({ operation: "scan_for_tasks", entity_type: "attachment" }))
    ).rejects.toThrow(/Cannot scan entity type 'attachment'/);
  });
});
