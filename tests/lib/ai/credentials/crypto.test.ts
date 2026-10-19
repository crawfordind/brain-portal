import { describe, it, expect } from "vitest";
import { AiKeySecretMissingError, decryptApiKey, encryptApiKey } from "@/lib/ai/credentials/crypto";

const SECRET = "a-test-secret-that-is-long-enough";
const KEY = "sk-ant-api03-very-secret";
const owner = { userId: "u1", provider: "anthropic" };

describe("stored key encryption", () => {
  it("round-trips, and never stores the key in clear", () => {
    const stored = encryptApiKey(KEY, owner, SECRET);
    expect(stored).not.toContain(KEY);
    expect(stored.startsWith("v1:")).toBe(true);
    expect(decryptApiKey(stored, owner, SECRET)).toBe(KEY);
  });

  it("uses a fresh IV every time", () => {
    expect(encryptApiKey(KEY, owner, SECRET)).not.toBe(encryptApiKey(KEY, owner, SECRET));
  });

  it("refuses a ciphertext moved onto another account's or provider's row", () => {
    const stored = encryptApiKey(KEY, owner, SECRET);
    expect(decryptApiKey(stored, { userId: "u2", provider: "anthropic" }, SECRET)).toBeNull();
    expect(decryptApiKey(stored, { userId: "u1", provider: "openai" }, SECRET)).toBeNull();
  });

  it("reads as unreadable, not wrong, after the secret changes or the value is tampered with", () => {
    const stored = encryptApiKey(KEY, owner, SECRET);
    expect(decryptApiKey(stored, owner, "a-different-secret-entirely")).toBeNull();
    expect(decryptApiKey(stored.slice(0, -4) + "AAAA", owner, SECRET)).toBeNull();
    expect(decryptApiKey("garbage", owner, SECRET)).toBeNull();
  });

  it("will not store a key without a server secret", () => {
    expect(() => encryptApiKey(KEY, owner, null)).toThrow(AiKeySecretMissingError);
  });
});
