/**
 * Jack connection settings, read from server environment only.
 *
 * Pure over the `env` it is given, so tests choose the environment instead of
 * mutating `process.env`. Nothing here may be sent to a browser except the
 * output of `publicJackStatus`, which names env vars but never their values.
 */

export type JackConfigState = "ready" | "disabled" | "misconfigured";

export interface JackConfig {
  state: JackConfigState;
  /** Why it is not ready, in terms an operator can act on. Never contains a value. */
  reason: string | null;
  /** Base URL with no trailing slash, e.g. `https://jack.example.com/p/jack`. */
  baseUrl: string;
  apiKey: string;
  /** The Hermes profile Brain Portal is bound to. Hermes advertises it as the model name. */
  profile: string;
  /** Optional edge credentials (e.g. a Cloudflare Access service token). */
  edgeHeaders: Record<string, string>;
}

type Env = Record<string, string | undefined>;

/** Hermes refuses to start with a key shorter than this; so does Brain Portal. */
const MIN_KEY_LENGTH = 16;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function getJackConfig(env: Env = process.env): JackConfig {
  const enabled = env.JACK_ENABLED?.trim().toLowerCase() === "true";
  const rawUrl = env.JACK_HERMES_URL?.trim() ?? "";
  const apiKey = env.JACK_HERMES_API_KEY?.trim() ?? "";
  const profile = env.JACK_PROFILE?.trim() || "jack";
  const production = env.NODE_ENV === "production";

  const base: JackConfig = {
    state: "disabled",
    reason: null,
    baseUrl: "",
    apiKey: "",
    profile,
    edgeHeaders: {},
  };

  if (!enabled) {
    return {
      ...base,
      reason: "Jack connection not configured. Set JACK_ENABLED=true once the Hermes endpoint is reachable.",
    };
  }

  const misconfigured = (reason: string): JackConfig => ({ ...base, state: "misconfigured", reason });

  if (!rawUrl) return misconfigured("JACK_HERMES_URL is not set.");
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return misconfigured("JACK_HERMES_URL is not a valid URL.");
  }
  if (url.username || url.password) {
    return misconfigured("JACK_HERMES_URL must not contain credentials; use JACK_HERMES_API_KEY.");
  }
  if (url.search || url.hash) {
    return misconfigured("JACK_HERMES_URL must not contain a query string or fragment.");
  }
  const loopback = LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback && !production)) {
    return misconfigured(
      "JACK_HERMES_URL must use https (plain http is allowed only for a loopback host outside production)."
    );
  }

  if (!apiKey) return misconfigured("JACK_HERMES_API_KEY is not set.");
  if (apiKey.length < MIN_KEY_LENGTH) {
    return misconfigured(`JACK_HERMES_API_KEY is shorter than ${MIN_KEY_LENGTH} characters.`);
  }

  const edgeId = env.JACK_EDGE_CLIENT_ID?.trim() ?? "";
  const edgeSecret = env.JACK_EDGE_CLIENT_SECRET?.trim() ?? "";
  if (!!edgeId !== !!edgeSecret) {
    return misconfigured("Set both JACK_EDGE_CLIENT_ID and JACK_EDGE_CLIENT_SECRET, or neither.");
  }
  const edgeHeaders: Record<string, string> = edgeId
    ? { "CF-Access-Client-Id": edgeId, "CF-Access-Client-Secret": edgeSecret }
    : {};

  return {
    state: "ready",
    reason: null,
    baseUrl: url.toString().replace(/\/+$/, ""),
    apiKey,
    profile,
    edgeHeaders,
  };
}

/** The only view of the configuration a browser may receive. */
export interface PublicJackStatus {
  state: JackConfigState;
  message: string;
  profile: string;
}

export function publicJackStatus(config: JackConfig = getJackConfig()): PublicJackStatus {
  return {
    state: config.state,
    profile: config.profile,
    message:
      config.state === "ready"
        ? `Delegated tasks run on Jack (Hermes profile "${config.profile}").`
        : config.reason ?? "Jack connection not configured.",
  };
}
