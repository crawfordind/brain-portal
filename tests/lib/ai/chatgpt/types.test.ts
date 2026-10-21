import { describe, it, expect } from "vitest";
import {
  buildAuthorizeUrl,
  chatGptPlanAccess,
  chooseChatGptModels,
  classifyChatGptError,
  needsRefresh,
  parseCallbackUrl,
  parseChatGptModelCatalog,
  toResponsesRequest,
  CHATGPT_REDIRECT_URI,
} from "@/lib/ai/chatgpt/types";
import { chooseCredentialChain } from "@/lib/ai/credentials/types";

describe("Sign in with ChatGPT: the authorize request", () => {
  it("registers the app on a first sign-in, with OpenAI's required parameters", () => {
    const url = new URL(buildAuthorizeUrl({ challenge: "c", state: "s", nonce: "n", hostId: "urn:uuid:x", clientId: null }));
    expect(url.origin + url.pathname).toBe("https://auth.openai.com/api/accounts/authorize");
    const p = url.searchParams;
    expect(p.get("client_id")).toBe("dynamic_agent_client");
    expect(p.get("agent_name_hint")).toBe("Brain Portal");
    expect(p.get("redirect_uri")).toBe("http://127.0.0.1:1455/auth/callback");
    expect(p.get("scope")).toContain("chatgpt.tokens.use.direct");
    expect(p.get("resource")).toBe("https://api.openai.com/v1");
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("ext_agent_host_id")).toBe("urn:uuid:x");
  });

  it("reuses the issued client id later, without registering again", () => {
    const p = new URL(
      buildAuthorizeUrl({ challenge: "c", state: "s", nonce: "n", hostId: "h", clientId: "oaiapp_1", idTokenHint: "idt" })
    ).searchParams;
    expect(p.get("client_id")).toBe("oaiapp_1");
    expect(p.get("id_token_hint")).toBe("idt");
    expect(p.has("agent_name_hint")).toBe(false);
  });
});

describe("reading the pasted address", () => {
  it("accepts the address however it was copied", () => {
    for (const pasted of [
      `${CHATGPT_REDIRECT_URI}?code=abc&state=xyz&client_id=oaiapp_1`,
      `  127.0.0.1:1455/auth/callback?code=abc&state=xyz&client_id=oaiapp_1  `,
      `"code=abc&state=xyz&client_id=oaiapp_1"`,
    ]) {
      expect(parseCallbackUrl(pasted)).toEqual({ ok: true, code: "abc", state: "xyz", clientId: "oaiapp_1" });
    }
  });

  it("explains a cancelled sign-in and an address with no code", () => {
    expect(parseCallbackUrl(`${CHATGPT_REDIRECT_URI}?error=access_denied`)).toMatchObject({ ok: false, message: expect.stringMatching(/cancelled/) });
    expect(parseCallbackUrl(CHATGPT_REDIRECT_URI)).toMatchObject({ ok: false, message: expect.stringMatching(/no sign-in code/) });
    expect(parseCallbackUrl("")).toMatchObject({ ok: false });
  });
});

describe("who may use a ChatGPT plan here (OpenAI: only a runtime the person controls)", () => {
  const check = (email: string, env: Record<string, string>, accountCount = 3) => chatGptPlanAccess({ email, env, accountCount });

  it("names the owners with CHATGPT_PLAN_USERS, else ADMIN_EMAILS", () => {
    expect(check("Owner@Example.com", { CHATGPT_PLAN_USERS: "owner@example.com" }).allowed).toBe(true);
    expect(check("other@example.com", { CHATGPT_PLAN_USERS: "owner@example.com" }).allowed).toBe(false);
    expect(check("owner@example.com", { ADMIN_EMAILS: "owner@example.com" }).allowed).toBe(true);
  });

  it("lets the only account on a single-person instance in, and asks a shared one to say who runs it", () => {
    expect(check("owner@example.com", {}, 1).allowed).toBe(true);
    expect(check("owner@example.com", {}, 4)).toMatchObject({ allowed: false, reason: expect.stringMatching(/CHATGPT_PLAN_USERS/) });
  });

  it("can be switched off", () => {
    expect(check("owner@example.com", { CHATGPT_PLAN_USERS: "off" }, 1).allowed).toBe(false);
  });
});

describe("the plan's model catalog", () => {
  it("keeps the picker entries in the server's order", () => {
    expect(
      parseChatGptModelCatalog({
        models: [
          { slug: "a", display_name: "A", visibility: "list" },
          { slug: "b", display_name: "B", visibility: "hide" },
          { slug: "c", visibility: "list" },
          { slug: "a", display_name: "A again", visibility: "list" },
        ],
      })
    ).toEqual([
      { slug: "a", displayName: "A" },
      { slug: "c", displayName: "c" },
    ]);
  });

  it("uses every entry when none is marked for a picker, and still reads the platform shape", () => {
    expect(parseChatGptModelCatalog({ models: [{ slug: "x", visibility: "hide" }] })).toEqual([{ slug: "x", displayName: "x" }]);
    expect(parseChatGptModelCatalog({ data: [{ id: "gpt-y" }] })).toEqual([{ slug: "gpt-y", displayName: "gpt-y" }]);
    expect(parseChatGptModelCatalog(null)).toEqual([]);
  });
});

describe("plan models and requests", () => {
  const available = ["gpt-plan-pro", "gpt-plan-mini", "gpt-plan-nano"];

  it("uses a light model for everyday jobs and the flagship for deep work", () => {
    expect(chooseChatGptModels({ slot: "fast", available })[0]).toBe("gpt-plan-mini");
    expect(chooseChatGptModels({ slot: "deep", available })[0]).toBe("gpt-plan-pro");
    expect(chooseChatGptModels({ slot: "fast", available, userChoice: "gpt-plan-pro" })[0]).toBe("gpt-plan-pro");
    // A saved choice the plan no longer offers heals to the default.
    expect(chooseChatGptModels({ slot: "fast", available, userChoice: "retired" })[0]).toBe("gpt-plan-mini");
  });

  it("puts the system prompt in instructions, which the plan requires", () => {
    const { instructions, input } = toResponsesRequest([
      { role: "system", content: "Be brief." },
      { role: "user", content: [{ type: "text", text: "What is this?" }, { type: "image_url", image_url: { url: "data:image/png;base64,AA" } }] },
      { role: "assistant", content: "A cat." },
    ]);
    expect(instructions).toBe("Be brief.");
    expect(input).toEqual([
      { type: "message", role: "user", content: [{ type: "input_text", text: "What is this?" }, { type: "input_image", image_url: "data:image/png;base64,AA" }] },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "A cat." }] },
    ]);
  });

  it("treats a used-up plan as a reason to try the next provider", () => {
    expect(classifyChatGptError("subscription_sharing_usage_limit_exceeded")).toMatchObject({ fallback: true });
    expect(classifyChatGptError("subscription_sharing_usage_unavailable")).toMatchObject({ fallback: true });
    expect(classifyChatGptError("chatpass_v2_scope_not_authorized")).toMatchObject({ message: expect.stringMatching(/Sign in with ChatGPT again/) });
    expect(classifyChatGptError("something_else")).toBeNull();
  });

  it("refreshes a couple of minutes before the token lapses", () => {
    expect(needsRefresh({ expiresAt: Date.now() + 60_000 })).toBe(true);
    expect(needsRefresh({ expiresAt: Date.now() + 30 * 60_000 })).toBe(false);
  });
});

describe("routing order and backups", () => {
  const base = {
    policy: "user_or_server" as const,
    capability: "chat" as const,
    hasUser: true,
    userProviders: ["anthropic", "chatgpt", "openrouter"] as Array<"anthropic" | "chatgpt" | "openrouter">,
    preferred: null,
    serverKey: true,
  };
  const providers = (chain: ReturnType<typeof chooseCredentialChain>) =>
    chain.map((c) => (c.kind === "none" ? c.code : `${c.kind}:${c.provider}`));

  it("tries the flat-rate plan first, then pay-per-token keys", () => {
    expect(providers(chooseCredentialChain(base))).toEqual(["user:chatgpt", "user:openrouter", "user:anthropic"]);
  });

  it("puts a preferred provider first", () => {
    expect(providers(chooseCredentialChain({ ...base, preferred: "anthropic" }))[0]).toBe("user:anthropic");
  });

  it("keeps the plan out of background work until the person agrees", () => {
    expect(providers(chooseCredentialChain({ ...base, routing: { background: true } }))[0]).toBe("user:openrouter");
    expect(providers(chooseCredentialChain({ ...base, routing: { background: true, chatgptBackground: true } }))[0]).toBe("user:chatgpt");
  });

  it("keeps the plan out entirely for an account not allowed one here", () => {
    expect(providers(chooseCredentialChain({ ...base, routing: { chatgptAllowed: false } }))).not.toContain("user:chatgpt");
  });

  it("uses only the first with backups off, and the server key only when asked", () => {
    expect(providers(chooseCredentialChain({ ...base, routing: { fallback: false } }))).toEqual(["user:chatgpt"]);
    expect(providers(chooseCredentialChain({ ...base, routing: { serverFallback: true } })).at(-1)).toBe("server:openrouter");
    expect(providers(chooseCredentialChain(base))).not.toContain("server:openrouter");
  });

  it("leaves Claude out of search indexing, which it can't do", () => {
    expect(providers(chooseCredentialChain({ ...base, capability: "embedding" }))).toEqual(["user:openrouter"]);
  });
});
