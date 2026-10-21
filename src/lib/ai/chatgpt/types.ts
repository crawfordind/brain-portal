/**
 * "Sign in with ChatGPT": run AI on the person's ChatGPT plan instead of a
 * pay-per-token key, through OpenAI's official flow for open-source apps
 * (https://developers.openai.com/siwc/token-sharing-open-source).
 *
 * Not the reused Codex CLI login some agents rely on: that borrows another
 * app's identity and calls ChatGPT's private backend, which OpenAI's docs say
 * not to use. This is the supported path: the app registers itself on first
 * sign-in, and inference goes to the public Responses API.
 *
 * Imports nothing, so the Settings panel, the routes and the tests share it.
 *
 * What the flow requires, and why the code looks the way it does:
 *
 * - The redirect is a loopback address on 127.0.0.1 ("only the port may
 *   vary"); a web server cannot receive it. The browser lands on a page that
 *   doesn't load, and the person pastes that address back into Settings. That
 *   is OpenAI's own advice for remote hosts: finish OAuth locally, then hand
 *   the result to the server the person controls.
 * - OpenAI's terms say plan usage must come from "a remote runtime only that
 *   user controls", and that one person's plan must never serve another's
 *   requests. So only the people who run this instance may connect a plan
 *   (`chatGptPlanAccess`), and a plan is only ever used for its owner's work.
 * - Background use needs the person's express consent, so it is a separate
 *   switch, off until they turn it on.
 */

export const CHATGPT_AUTHORIZE_URL = "https://auth.openai.com/api/accounts/authorize";
export const CHATGPT_TOKEN_URL = "https://auth.openai.com/api/accounts/oauth/token";
export const CHATGPT_ISSUER = "https://auth.openai.com";
export const CHATGPT_API_BASE = "https://api.openai.com/v1";
/** First sign-in only: the registration entry point, never saved or exchanged. */
export const CHATGPT_ENTRY_CLIENT_ID = "dynamic_agent_client";
export const CHATGPT_REDIRECT_URI = "http://127.0.0.1:1455/auth/callback";
export const CHATGPT_SCOPES = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
/** The scope that actually authorizes plan usage; sign-in alone does not. */
export const CHATGPT_PLAN_SCOPE = "chatgpt.tokens.use.direct";
export const CHATGPT_APP_NAME = "Brain Portal";
/** Where the person sees and limits what apps use of their plan. */
export const CHATGPT_MANAGE_USAGE_URL = "https://chatgpt.com/#settings";

/** What is stored, encrypted, in place of an API key. */
export interface ChatGptSession {
  /** Issued on first sign-in ("oaiapp_…"); reused for every later one. */
  clientId: string;
  hostId: string;
  idToken: string;
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
  scopes: string[];
  email: string | null;
  savedAt: number;
}

export function parseChatGptSession(raw: string | null | undefined): ChatGptSession | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Partial<ChatGptSession>;
    if (
      typeof s.clientId !== "string" ||
      typeof s.accessToken !== "string" ||
      typeof s.refreshToken !== "string" ||
      typeof s.expiresAt !== "number"
    ) {
      return null;
    }
    return {
      clientId: s.clientId,
      hostId: typeof s.hostId === "string" ? s.hostId : "",
      idToken: typeof s.idToken === "string" ? s.idToken : "",
      accessToken: s.accessToken,
      refreshToken: s.refreshToken,
      expiresAt: s.expiresAt,
      scopes: Array.isArray(s.scopes) ? s.scopes.filter((x): x is string => typeof x === "string") : [],
      email: typeof s.email === "string" ? s.email : null,
      savedAt: typeof s.savedAt === "number" ? s.savedAt : 0,
    };
  } catch {
    return null;
  }
}

/** Refresh a little early, so a call never starts with a token about to lapse. */
export function needsRefresh(session: Pick<ChatGptSession, "expiresAt">, now = Date.now()): boolean {
  return session.expiresAt - now < 2 * 60 * 1000;
}

export function buildAuthorizeUrl(input: {
  challenge: string;
  state: string;
  nonce: string;
  hostId: string;
  /** Null on the first sign-in, which registers the app. */
  clientId: string | null;
  idTokenHint?: string | null;
}): string {
  const url = new URL(CHATGPT_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId ?? CHATGPT_ENTRY_CLIENT_ID);
  url.searchParams.set("redirect_uri", CHATGPT_REDIRECT_URI);
  url.searchParams.set("scope", CHATGPT_SCOPES);
  url.searchParams.set("resource", CHATGPT_API_BASE);
  url.searchParams.set("code_challenge", input.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", input.state);
  url.searchParams.set("nonce", input.nonce);
  url.searchParams.set("ext_agent_host_id", input.hostId);
  if (input.clientId) {
    if (input.idTokenHint) url.searchParams.set("id_token_hint", input.idTokenHint);
  } else {
    url.searchParams.set("agent_name_hint", CHATGPT_APP_NAME);
  }
  return url.toString();
}

export type CallbackResult =
  | { ok: true; code: string; state: string; clientId: string | null }
  | { ok: false; message: string };

/**
 * Read the address the browser was sent back to. People paste it with or
 * without the scheme, with spaces, or only the part after "?".
 */
export function parseCallbackUrl(pasted: string): CallbackResult {
  const text = pasted.trim().replace(/^["'<]+|["'>]+$/g, "");
  if (!text) return { ok: false, message: "Paste the address from the page ChatGPT sent you to." };
  let params: URLSearchParams;
  try {
    if (/^https?:\/\//i.test(text)) params = new URL(text).searchParams;
    else if (/^(127\.0\.0\.1|localhost)[:/]/i.test(text)) params = new URL(`http://${text}`).searchParams;
    else params = new URLSearchParams(text.replace(/^[^?]*\?/, ""));
  } catch {
    return { ok: false, message: "That doesn't look like the address ChatGPT sent you to. Copy the whole address bar." };
  }
  const error = params.get("error");
  if (error) {
    const detail = params.get("error_description");
    return { ok: false, message: error === "access_denied" ? "Sign-in was cancelled in ChatGPT." : `ChatGPT said: ${detail || error}` };
  }
  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) {
    return { ok: false, message: "That address has no sign-in code in it. Copy the whole address after approving in ChatGPT." };
  }
  return { ok: true, code, state, clientId: params.get("client_id") };
}

/**
 * Who may connect a ChatGPT plan on this instance. OpenAI allows plan usage
 * only from a runtime the person controls, so: the people named in
 * `CHATGPT_PLAN_USERS`, else `ADMIN_EMAILS`, else, on an instance with a
 * single account, that account. `CHATGPT_PLAN_USERS=off` turns it off.
 */
export function chatGptPlanAccess(input: {
  email: string;
  env: Record<string, string | undefined>;
  accountCount: number;
}): { allowed: boolean; reason: string | null } {
  const list = (value: string | undefined) =>
    (value ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
  const raw = input.env.CHATGPT_PLAN_USERS?.trim();
  if (raw && raw.toLowerCase() === "off") {
    return { allowed: false, reason: "Signing in with ChatGPT is turned off on this server." };
  }
  const email = input.email.trim().toLowerCase();
  const named = raw ? list(raw) : list(input.env.ADMIN_EMAILS);
  if (named.length > 0) {
    return named.includes(email)
      ? { allowed: true, reason: null }
      : {
          allowed: false,
          reason:
            "OpenAI only allows a ChatGPT plan to be used on a server its owner runs. Ask the person who runs this one to add your address to CHATGPT_PLAN_USERS if that's you.",
        };
  }
  if (input.accountCount <= 1) return { allowed: true, reason: null };
  return {
    allowed: false,
    reason:
      "This server has several accounts, so it needs to know who runs it before a ChatGPT plan can be used. Set CHATGPT_PLAN_USERS (or ADMIN_EMAILS) to your address.",
  };
}

export interface ChatGptModel {
  slug: string;
  displayName: string;
}

/**
 * Read a plan's model catalog. With a ChatGPT plan token, `GET /v1/models`
 * returns `{ models: [{ slug, display_name, visibility }] }`, not the
 * platform API's `{ data: [{ id }] }`; reading `data` is what made every plan
 * look like it had no models. OpenAI says to show the entries whose
 * `visibility` is "list", in the server's order (best first). The platform
 * shape is still accepted, in case the endpoint ever converges on it.
 */
export function parseChatGptModelCatalog(body: unknown): ChatGptModel[] {
  const b = (body ?? {}) as { models?: unknown; data?: unknown };
  const raw = Array.isArray(b.models) ? b.models : Array.isArray(b.data) ? b.data : Array.isArray(body) ? body : [];
  const entries = (raw as Array<Record<string, unknown>>)
    .map((m) => {
      const slug = typeof m?.slug === "string" ? m.slug : typeof m?.id === "string" ? m.id : null;
      if (!slug) return null;
      return {
        slug,
        displayName: typeof m.display_name === "string" && m.display_name ? m.display_name : slug,
        visibility: typeof m.visibility === "string" ? m.visibility : null,
      };
    })
    .filter((m): m is { slug: string; displayName: string; visibility: string | null } => m !== null);
  const listed = entries.filter((m) => m.visibility === null || m.visibility === "list");
  // If nothing is marked for a picker, the account can still use what it has.
  const chosen = listed.length > 0 ? listed : entries;
  const seen = new Set<string>();
  return chosen
    .filter((m) => (seen.has(m.slug) ? false : (seen.add(m.slug), true)))
    .map(({ slug, displayName }) => ({ slug, displayName }));
}

/** OpenAI's plan-usage error codes, and what each means for routing. */
export function classifyChatGptError(code: string | null | undefined): {
  /** True when another provider should be tried. */
  fallback: boolean;
  message: string;
} | null {
  switch (code) {
    case "subscription_sharing_usage_limit_exceeded":
      return { fallback: true, message: "Your ChatGPT plan's usage limit is used up for now." };
    case "subscription_sharing_user_not_eligible":
      return { fallback: true, message: "This ChatGPT account's plan can't be used in other apps (Plus or Pro is needed)." };
    case "subscription_sharing_unsupported_capability":
      return { fallback: true, message: "Your ChatGPT plan can't do this kind of request." };
    case "subscription_sharing_route_not_supported":
      return { fallback: true, message: "Your ChatGPT plan can't be used for this request." };
    case "subscription_sharing_usage_unavailable":
    case "subscription_sharing_user_unavailable":
      return { fallback: true, message: "ChatGPT plan usage is busy right now. Try again in a moment." };
    case "subscription_sharing_invalid_user":
    case "chatpass_v2_scope_not_authorized":
    case "chatpass_v2_invalid_authorization_context":
      return {
        fallback: true,
        message: "Your ChatGPT sign-in needs renewing. Sign in with ChatGPT again in Settings → AI provider.",
      };
    default:
      return null;
  }
}

/**
 * Choose a model for a job from the plan's own list. OpenAI doesn't publish a
 * fixed list, so the choice is made from what the account offers: a saved
 * choice first, then a light model ("mini", "nano") for quick background
 * jobs, which use less of the plan, and the first listed (the flagship) for
 * everything else.
 */
export function chooseChatGptModels(input: {
  slot: string;
  available: string[];
  userChoice?: string | null;
}): string[] {
  const { available, userChoice } = input;
  if (available.length === 0) return userChoice ? [userChoice] : [];
  const light = available.filter((id) => /(mini|nano|lite|small|fast)/i.test(id));
  const heavy = available.filter((id) => !light.includes(id));
  const ordered = input.slot === "fast" ? [...light, ...heavy] : [...heavy, ...light];
  const chain = userChoice && available.includes(userChoice) ? [userChoice, ...ordered] : ordered;
  return chain.filter((id, i) => chain.indexOf(id) === i).slice(0, 3);
}

/** The Responses API input for OpenAI-style chat messages. */
export function toResponsesRequest(
  messages: Array<{ role: string; content?: unknown }>
): { instructions: string | undefined; input: Array<{ type: "message"; role: "user" | "assistant"; content: unknown[] }> } {
  const instructions: string[] = [];
  const input: Array<{ type: "message"; role: "user" | "assistant"; content: unknown[] }> = [];
  for (const m of messages) {
    if (m.role === "system" || m.role === "developer") {
      const text = typeof m.content === "string" ? m.content : "";
      if (text) instructions.push(text);
      continue;
    }
    if (m.role !== "user" && m.role !== "assistant") continue;
    const textType = m.role === "user" ? "input_text" : "output_text";
    const parts: unknown[] = [];
    if (typeof m.content === "string") {
      if (m.content) parts.push({ type: textType, text: m.content });
    } else if (Array.isArray(m.content)) {
      for (const part of m.content as Array<{ type?: string; text?: string; image_url?: { url?: string } }>) {
        if (part.type === "text" && part.text) parts.push({ type: textType, text: part.text });
        else if (part.type === "image_url" && part.image_url?.url && m.role === "user") {
          parts.push({ type: "input_image", image_url: part.image_url.url });
        }
      }
    }
    if (parts.length > 0) input.push({ type: "message", role: m.role, content: parts });
  }
  return { instructions: instructions.length > 0 ? instructions.join("\n\n") : undefined, input };
}
