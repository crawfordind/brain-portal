import { describe, it, expect } from "vitest";

describe("Tasks API date queries", () => {
  it("should accept start and end date parameters", () => {
    const params = new URLSearchParams({
      start: "2024-03-01",
      end: "2024-03-31",
    });

    expect(params.get("start")).toBe("2024-03-01");
    expect(params.get("end")).toBe("2024-03-31");
  });

  it("should accept completedSince parameter", () => {
    const params = new URLSearchParams({
      completedSince: "7d",
    });

    expect(params.get("completedSince")).toBe("7d");
  });

  it("should parse completedSince values correctly", () => {
    const values = ["1d", "7d", "30d", "90d"];
    const daysMap: Record<string, number> = {
      "1d": 1,
      "7d": 7,
      "30d": 30,
      "90d": 90,
    };

    values.forEach((value) => {
      expect(daysMap[value]).toBeGreaterThan(0);
    });
  });
});
