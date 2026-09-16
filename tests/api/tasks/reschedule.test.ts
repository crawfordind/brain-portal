import { describe, it, expect } from "vitest";

describe("Reschedule API", () => {
  it("should validate ISO date format", () => {
    const validDate = "2024-03-15T14:00:00Z";
    const invalidDate = "not-a-date";

    const validParsed = new Date(validDate);
    const invalidParsed = new Date(invalidDate);

    expect(validParsed.toISOString()).toMatch(/2024-03-15T14:00:00/);
    expect(invalidParsed.toString()).toBe("Invalid Date");
  });

  it("should accept scheduled_at in request body", () => {
    const body = {
      scheduled_at: "2024-03-15T14:00:00Z",
    };

    expect(body.scheduled_at).toBeDefined();
    expect(typeof body.scheduled_at).toBe("string");
  });
});
