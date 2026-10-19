/**
 * Whose key pays for a call. These rules decide whose money is spent, so each
 * one is pinned: a user's own key always wins, the server's key stands in only
 * when the user has nothing that can do the job, and a policy is never bent.
 */
import { describe, it, expect } from "vitest";
import {
  chooseCredential,
  keyFormatProblem,
  keyHint,
  normalizeApiKey,
  parseAiKeyPolicy,
  credentialErrorMessage,
} from "@/lib/ai/credentials/types";

const base = { policy: "user_or_server" as const, capability: "chat" as const, hasUser: true, userProviders: [], preferred: null, serverKey: true };

describe("chooseCredential", () => {
  it("uses the server key for an account with no key of its own (the pre-existing behaviour)", () => {
    expect(chooseCredential(base)).toEqual({ kind: "server", provider: "openrouter", reason: "no_user_key" });
  });

  it("uses the account's own key whenever it has a capable one", () => {
    expect(chooseCredential({ ...base, userProviders: ["anthropic"] })).toEqual({ kind: "user", provider: "anthropic" });
  });

  it("puts the preferred provider first, then OpenRouter, OpenAI, Anthropic", () => {
    const all = ["anthropic", "openai", "openrouter"] as const;
    expect(chooseCredential({ ...base, userProviders: [...all] })).toEqual({ kind: "user", provider: "openrouter" });
    expect(chooseCredential({ ...base, userProviders: [...all], preferred: "anthropic" })).toEqual({ kind: "user", provider: "anthropic" });
  });

  it("skips a preferred provider that can't do the job: Claude has no embeddings", () => {
    expect(
      chooseCredential({ ...base, capability: "embedding", userProviders: ["anthropic", "openai"], preferred: "anthropic" })
    ).toEqual({ kind: "user", provider: "openai" });
  });

  it("covers a Claude-only account's search index with the server key, and says why", () => {
    expect(chooseCredential({ ...base, capability: "embedding", userProviders: ["anthropic"] })).toEqual({
      kind: "server",
      provider: "openrouter",
      reason: "capability_gap",
    });
  });

  it("never spends the server key on an account when the operator requires personal keys", () => {
    const policy = "user_only" as const;
    expect(chooseCredential({ ...base, policy })).toEqual({ kind: "none", code: "user_key_required" });
    expect(chooseCredential({ ...base, policy, capability: "embedding", userProviders: ["anthropic"] })).toEqual({
      kind: "none",
      code: "capability_missing",
    });
  });

  it("still runs work that belongs to no account on the server key, under user_only", () => {
    expect(chooseCredential({ ...base, policy: "user_only", hasUser: false })).toEqual({
      kind: "server",
      provider: "openrouter",
      reason: "system",
    });
  });

  it("ignores personal keys entirely when they are switched off", () => {
    expect(chooseCredential({ ...base, policy: "server_only", userProviders: ["openai"] })).toMatchObject({ kind: "server" });
    expect(chooseCredential({ ...base, policy: "server_only", serverKey: false })).toEqual({ kind: "none", code: "server_key_missing" });
  });

  it("reports no key at all honestly", () => {
    expect(chooseCredential({ ...base, serverKey: false })).toEqual({ kind: "none", code: "no_key" });
  });
});

describe("key handling", () => {
  it("strips what people paste along with a key", () => {
    expect(normalizeApiKey('  "Bearer sk-ant-api03-abc"  ')).toBe("sk-ant-api03-abc");
  });

  it("catches a key pasted under the wrong provider before any network call", () => {
    const anthropicKey = "sk-ant-api03-" + "x".repeat(40);
    expect(keyFormatProblem("openai", anthropicKey)).toMatch(/looks like an Anthropic \(Claude\) key/);
    expect(keyFormatProblem("anthropic", "sk-or-v1-" + "x".repeat(40))).toMatch(/looks like an OpenRouter key/);
    expect(keyFormatProblem("anthropic", anthropicKey)).toBeNull();
    expect(keyFormatProblem("openai", "sk-proj-" + "x".repeat(40))).toBeNull();
    expect(keyFormatProblem("openai", "abc")).toMatch(/complete/);
  });

  it("shows only a hint, never the key", () => {
    const key = "sk-ant-api03-" + "s".repeat(40) + "a1b2";
    expect(keyHint(key)).toBe("sk-ant-…a1b2");
    expect(keyHint(key)).not.toContain("sss");
  });

  it("defaults the policy to the behaviour every deployment had before", () => {
    expect(parseAiKeyPolicy(undefined)).toBe("user_or_server");
    expect(parseAiKeyPolicy("nonsense")).toBe("user_or_server");
    expect(parseAiKeyPolicy(" USER_ONLY ")).toBe("user_only");
  });

  it("tells the person what to do, without naming any value", () => {
    expect(credentialErrorMessage("capability_missing", "embedding")).toMatch(/OpenRouter or OpenAI/);
    expect(credentialErrorMessage("user_key_required", "chat")).toMatch(/Settings → AI provider/);
  });
});
