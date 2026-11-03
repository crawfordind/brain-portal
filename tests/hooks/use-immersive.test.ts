import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { IMMERSIVE_STORAGE_KEY, parseImmersive, useImmersive } from "@/hooks/use-immersive";

describe("useImmersive", () => {
  beforeEach(() => window.localStorage.clear());

  it("is on unless explicitly turned off", () => {
    expect(parseImmersive(null)).toBe(true);
    expect(parseImmersive("on")).toBe(true);
    expect(parseImmersive("off")).toBe(false);
  });

  it("remembers the choice on this device and tells every reader", () => {
    const a = renderHook(() => useImmersive());
    const b = renderHook(() => useImmersive());
    expect(a.result.current[0]).toBe(true);

    act(() => a.result.current[1](false));
    expect(window.localStorage.getItem(IMMERSIVE_STORAGE_KEY)).toBe("off");
    expect(a.result.current[0]).toBe(false);
    expect(b.result.current[0]).toBe(false);
  });
});
