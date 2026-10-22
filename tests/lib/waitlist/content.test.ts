import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  AI_CONTROL,
  BRAIN_BAR_EXAMPLES,
  FAQ,
  FEATURE_INDEX,
  LIMITS,
  PILLARS,
  STEPS,
  TRUST,
  type Claim,
} from "@/lib/waitlist/content";

const ROOT = resolve(__dirname, "../../..");

const CLAIMS: Claim[] = [
  ...PILLARS,
  ...AI_CONTROL,
  ...FEATURE_INDEX.flatMap((g) => g.items),
  ...TRUST,
  ...LIMITS,
];

/** Every string the landing page shows from this module. */
const ALL_COPY = [
  ...PILLARS.flatMap((p) => [p.eyebrow, p.title, p.body, ...p.points]),
  ...CLAIMS.flatMap((c) => [c.title, c.body]),
  ...BRAIN_BAR_EXAMPLES.flatMap((e) => [e.input, e.kind, e.result]),
  ...STEPS.flatMap((s) => [s.title, s.body]),
  ...FAQ.flatMap((f) => [f.q, f.a]),
  ...FEATURE_INDEX.map((g) => g.title),
].join("\n");

describe("landing page claims", () => {
  it("every claim names code that exists", () => {
    const missing = CLAIMS.flatMap((c) =>
      c.evidence.filter((path) => !existsSync(resolve(ROOT, path))).map((path) => `${c.title}: ${path}`)
    );
    expect(missing).toEqual([]);
    for (const c of CLAIMS) expect(c.evidence.length).toBeGreaterThan(0);
  });

  it("keeps out claims that were false when the old page made them", () => {
    // Each of these once appeared on the page and did not match the product.
    expect(ALL_COPY).not.toMatch(/month view|monthly view/i); // the calendar is day + week
    expect(ALL_COPY).not.toMatch(/every capture/i); // only notes are auto-tagged
    expect(ALL_COPY).not.toMatch(/frontmatter/i); // only import/export reads it
    expect(ALL_COPY).not.toMatch(/related notes appear/i); // no panel beside the editor
    expect(ALL_COPY).not.toMatch(/one-click (vault )?(migration|import)/i); // API only, no UI
    expect(ALL_COPY).not.toMatch(/never trains/i); // provider policy, not ours to promise
  });

  it("never hard-codes a count the page can compute", () => {
    // MCP tool, resource and prompt counts come from the catalog.
    expect(ALL_COPY).not.toMatch(/\b\d+\s+(MCP\s+)?(tools|resources|prompts|skills)\b/i);
  });

  it("names no competitor and invents no social proof", () => {
    expect(ALL_COPY).not.toMatch(/\b(Notion|Roam|Mem|Apple Notes|Evernote)\b/);
    expect(ALL_COPY).not.toMatch(/testimonial|trusted by|\d[\d,]*\+? (users|people|teams)/i);
  });

  it("has no em dashes in shipped copy", () => {
    expect(ALL_COPY).not.toContain("—");
  });
});
