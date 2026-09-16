import { describe, it, expect } from "vitest";
import {
  STREAM_DENSITIES,
  DENSITY_LABELS,
  SERVER_DEFAULT_DENSITY,
  parseDensity,
  defaultDensity,
  nextDensity,
} from "@/lib/stream/density";
import type { StreamDensity } from "@/lib/stream/density";

describe("parseDensity", () => {
  it("accepts every known density", () => {
    for (const density of STREAM_DENSITIES) {
      expect(parseDensity(density)).toBe(density);
    }
  });

  it("returns null for absent or unknown values rather than guessing", () => {
    // A value written by an older build, or edited by hand, has to degrade to
    // "no preference" so the caller decides — not silently become `compact`.
    expect(parseDensity(null)).toBeNull();
    expect(parseDensity(undefined)).toBeNull();
    expect(parseDensity("")).toBeNull();
    expect(parseDensity("roomy")).toBeNull();
    expect(parseDensity("COMPACT")).toBeNull();
  });
});

describe("defaultDensity", () => {
  it("starts touch viewers on cozy — a phone has no hover to preview with", () => {
    expect(defaultDensity(true)).toBe("cozy");
  });

  it("starts pointer viewers on compact", () => {
    expect(defaultDensity(false)).toBe("compact");
  });
});

describe("nextDensity", () => {
  it("cycles through every density and returns to the start", () => {
    let density: StreamDensity = STREAM_DENSITIES[0];
    const seen: StreamDensity[] = [density];

    for (let i = 0; i < STREAM_DENSITIES.length - 1; i++) {
      density = nextDensity(density);
      seen.push(density);
    }

    expect(seen).toEqual([...STREAM_DENSITIES]);
    expect(nextDensity(density)).toBe(STREAM_DENSITIES[0]);
  });
});

describe("the vocabulary itself", () => {
  it("labels every density", () => {
    for (const density of STREAM_DENSITIES) {
      expect(DENSITY_LABELS[density].label).toBeTruthy();
      expect(DENSITY_LABELS[density].hint).toBeTruthy();
    }
  });

  it("has a server default that is a real density", () => {
    expect(STREAM_DENSITIES).toContain(SERVER_DEFAULT_DENSITY);
  });
});
