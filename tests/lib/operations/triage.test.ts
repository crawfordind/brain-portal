import { describe, it, expect } from "vitest";
import { extractDueDate, proposeTriage, proposalTitle } from "@/lib/operations/triage";

const CONTEXT = {
  today: "2026-10-08",
  projects: [
    { id: "p1", name: "Corner Store", ventureName: "Harbor Co-op" },
    { id: "p2", name: "Orchard Grant", ventureName: "Northwind Farms" },
    { id: "p3", name: "Spawn Lab", ventureName: "Northwind Farms" },
  ],
  contacts: [
    { id: "e1", name: "Will" },
    { id: "e2", name: "Dana Reyes" },
  ],
};

function propose(content: string, captureType = "thought", capturedAt = "2026-10-08 09:00:00") {
  return proposeTriage({ content, captureType, capturedAt }, CONTEXT);
}

describe("proposeTriage", () => {
  it("reads waiting-on and links the named contact", () => {
    const p = propose("Waiting on Will to send the cooler quote for the Corner Store");
    expect(p).toMatchObject({
      kind: "waiting",
      counterparty: "Will",
      counterpartyEntityId: "e1",
      projectId: "p1",
      confidence: "clear",
    });
  });

  it("does not mistake the verb 'will' for the contact Will", () => {
    const p = propose("I think the market will be busy this weekend");
    expect(p.counterpartyEntityId).toBeNull();
  });

  it("reads a decision and its options", () => {
    const p = propose("Need to decide between Supplier B and Supplier A for seed");
    expect(p.kind).toBe("decision");
    expect(p.options).toEqual(["Supplier B", "Supplier A for seed"]);
  });

  it("reads promises in both directions", () => {
    expect(propose("I promised Dana Reyes the soil samples by Friday")).toMatchObject({
      kind: "commitment",
      direction: "i_owe",
      counterparty: "Dana Reyes",
      dueDate: "2026-10-09",
    });
    expect(propose("Dana Reyes promised the signed letter")).toMatchObject({
      kind: "commitment",
      direction: "they_owe",
    });
  });

  it("files links and quotes as reference with no date", () => {
    const p = propose("https://example.com/grant tomorrow", "link");
    expect(p).toMatchObject({ kind: "reference", dueDate: null });
  });

  it("says unclear rather than inventing a kind", () => {
    const p = propose("mycelium networks are like the internet");
    expect(p).toMatchObject({ kind: "context", confidence: "unclear" });
  });

  it("maps a venture name to a project only when the venture has exactly one", () => {
    expect(propose("Harbor Co-op shelf reset").projectId).toBe("p1");
    expect(propose("Northwind Farms fencing").projectId).toBeNull();
  });
});

describe("extractDueDate", () => {
  it("reads relative dates against the capture day, not today", () => {
    expect(extractDueDate("call them tomorrow", "2026-10-01")).toEqual({ date: "2026-10-02", basis: "tomorrow" });
  });

  it("reads weekdays forward", () => {
    // 2026-10-08 is a Thursday
    expect(extractDueDate("by friday", "2026-10-08")?.date).toBe("2026-10-09");
    expect(extractDueDate("by thursday", "2026-10-08")?.date).toBe("2026-10-15");
  });

  it("rolls a month-day far behind the capture into next year", () => {
    expect(extractDueDate("due Jan 5", "2026-12-10")?.date).toBe("2027-01-05");
    expect(extractDueDate("due Oct 20", "2026-10-08")?.date).toBe("2026-10-20");
  });

  it("returns null when no date is stated", () => {
    expect(extractDueDate("someday", "2026-10-08")).toBeNull();
  });
});

describe("proposalTitle", () => {
  it("strips list and todo markup", () => {
    expect(proposalTitle("- [ ] TODO: call the county\nmore")).toBe("call the county");
  });
});
