/**
 * Which runtime executes delegated tasks, read from server environment only.
 *
 *   AGENT_RUNTIME=openrouter   (default) a single model call through OpenRouter
 *   AGENT_RUNTIME=hermes       a Hermes Agent profile through its Runs API
 *   AGENT_RUNTIME=off          delegation stored but never executed
 *
 * The choice is explicit and there is no fallback between runtimes: a
 * deployment on `hermes` never spends OpenRouter credits on delegated work,
 * however unreachable Hermes is, and an `openrouter` deployment never calls
 * a Hermes endpoint.
 *
 * Pure over the `env` it is given, so tests choose the environment instead of
 * mutating `process.env`. Nothing here may be sent to a browser except the
 * output of `publicRuntimeStatus`, which names env vars but never their values.
 */

import type { RuntimeName } from "./types";

export type RuntimeConfigState = "ready" | "disabled" | "misconfigured";

export interface HermesConfig {
  /** Base URL with no trailing slash, e.g. `https://agent.example.com/p/my-profile`. */
  baseUrl: string;
  apiKey: string;
  /** The Hermes profile Brain Portal expects; checked by the connection test. Optional. */
  profile: string | null;
  /** Optional edge credentials (e.g. a Cloudflare Access service token). */
  edgeHeaders: Record<string, string>;
}

export interface RuntimeConfig {
  /** The runtime that executes delegated tasks, or null when delegation is off or misconfigured. */
  runtime: RuntimeName | null;
  /** What `AGENT_RUNTIME` asked for, for messages. */
  requested: string;
  state: RuntimeConfigState;
  /** Why it is not ready, in terms an operator can act on. Never contains a value. */
  reason: string | null;
  /** What the UI calls the agent ("Send to <displayName>"). */
  displayName: string;
  hermes: HermesConfig | null;
}

type Env = Record<string, string | undefined>;

/** Hermes refuses to start with a key shorter than this; so does Brain Portal. */
const MIN_KEY_LENGTH = 16;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const DEFAULT_DISPLAY_NAME = "Agent";

export function getRuntimeConfig(env: Env = process.env): RuntimeConfig {
  const requested = (env.AGENT_RUNTIME?.trim().toLowerCase() || "openrouter");
  const displayName = cleanDisplayName(env.AGENT_DISPLAY_NAME);
  const base = { requested, displayName, hermes: null };

  const misconfigured = (reason: string, runtime: RuntimeName | null = null): RuntimeConfig => ({
    ...base,
    runtime,
    state: "misconfigured",
    reason,
  });

  switch (requested) {
    case "off":
      return {
        ...base,
        runtime: null,
        state: "disabled",
        reason: "Delegated tasks are turned off on this server (AGENT_RUNTIME=off). Tasks are kept but not run.",
      };

    case "openrouter":
      if (!env.OPENROUTER_API_KEY?.trim()) {
        return misconfigured("AGENT_RUNTIME is openrouter but OPENROUTER_API_KEY is not set.", "openrouter");
      }
      return { ...base, runtime: "openrouter", state: "ready", reason: null };

    case "hermes": {
      const hermes = parseHermes(env);
      if (typeof hermes === "string") return misconfigured(hermes, "hermes");
      return { ...base, runtime: "hermes", state: "ready", reason: null, hermes };
    }

    default:
      return misconfigured(`AGENT_RUNTIME must be openrouter, hermes or off (got an unrecognised value).`);
  }
}

function cleanDisplayName(raw: string | undefined): string {
  const name = (raw ?? "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 40);
  return name || DEFAULT_DISPLAY_NAME;
}

/** A valid Hermes configuration, or the reason it is not one. */
function parseHermes(env: Env): HermesConfig | string {
  const rawUrl = env.HERMES_URL?.trim() ?? "";
  const apiKey = env.HERMES_API_KEY?.trim() ?? "";
  const production = env.NODE_ENV === "production";

  if (!rawUrl) return "AGENT_RUNTIME is hermes but HERMES_URL is not set.";
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return "HERMES_URL is not a valid URL.";
  }
  if (url.username || url.password) {
    return "HERMES_URL must not contain credentials; use HERMES_API_KEY.";
  }
  if (url.search || url.hash) {
    return "HERMES_URL must not contain a query string or fragment.";
  }
  const loopback = LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback && !production)) {
    return "HERMES_URL must use https (plain http is allowed only for a loopback host outside production).";
  }

  if (!apiKey) return "AGENT_RUNTIME is hermes but HERMES_API_KEY is not set.";
  if (apiKey.length < MIN_KEY_LENGTH) {
    return `HERMES_API_KEY is shorter than ${MIN_KEY_LENGTH} characters.`;
  }

  const edgeId = env.HERMES_EDGE_CLIENT_ID?.trim() ?? "";
  const edgeSecret = env.HERMES_EDGE_CLIENT_SECRET?.trim() ?? "";
  if (!!edgeId !== !!edgeSecret) {
    return "Set both HERMES_EDGE_CLIENT_ID and HERMES_EDGE_CLIENT_SECRET, or neither.";
  }

  return {
    baseUrl: url.toString().replace(/\/+$/, ""),
    apiKey,
    profile: env.HERMES_PROFILE?.trim() || null,
    edgeHeaders: edgeId ? { "CF-Access-Client-Id": edgeId, "CF-Access-Client-Secret": edgeSecret } : {},
  };
}

/** What a runtime can do, so the UI offers only the actions that exist. */
export interface RuntimeCapabilities {
  approvals: boolean;
  stop: boolean;
  liveStatus: boolean;
  connectionTest: boolean;
}

export function capabilitiesOf(runtime: RuntimeName | null): RuntimeCapabilities {
  return runtime === "hermes"
    ? { approvals: true, stop: true, liveStatus: true, connectionTest: true }
    : { approvals: false, stop: false, liveStatus: false, connectionTest: false };
}

/** The only view of the configuration a browser may receive. */
export interface PublicRuntimeStatus {
  state: RuntimeConfigState;
  runtime: RuntimeName | null;
  displayName: string;
  message: string;
  capabilities: RuntimeCapabilities;
}

export function publicRuntimeStatus(config: RuntimeConfig = getRuntimeConfig()): PublicRuntimeStatus {
  const message =
    config.state !== "ready"
      ? config.reason ?? "Delegated tasks are not configured."
      : config.runtime === "hermes"
        ? `Delegated tasks run on ${config.displayName}, a Hermes agent.`
        : `Delegated tasks run on ${config.displayName}, through OpenRouter.`;
  return {
    state: config.state,
    runtime: config.runtime,
    displayName: config.displayName,
    message,
    capabilities: capabilitiesOf(config.state === "ready" ? config.runtime : null),
  };
}
