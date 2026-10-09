import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getRuntimeConfig, publicRuntimeStatus } from "@/lib/agents/runtime/config";
import { createHermesClient, RuntimeError } from "@/lib/agents/runtime/hermes-client";
import { rateLimited } from "@/lib/agents/runtime/http";

/**
 * GET /api/agent-runtime/status — which runtime runs delegated tasks, its
 * display name, what it can do, and whether it is configured, in words.
 *
 * `?check=true` on a Hermes runtime makes one live call (`/v1/capabilities`)
 * and confirms the endpoint answers, accepts the key, is the expected profile
 * (when `HERMES_PROFILE` is set) and supports runs and stop. OpenRouter needs
 * no live check here: its key is checked by the model settings page.
 *
 * Never returns a URL, a key or anything the runtime sent beyond those facts.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const config = getRuntimeConfig();
  const status = publicRuntimeStatus(config);
  if (request.nextUrl.searchParams.get("check") !== "true" || config.state !== "ready" || config.runtime !== "hermes") {
    return NextResponse.json(status);
  }

  const limited = rateLimited(user.id, "check");
  if (limited) return limited;

  try {
    const caps = await createHermesClient(config.hermes!, { timeoutMs: 8_000 }).capabilities();
    const required = ["run_submission", "run_status", "run_stop"] as const;
    const missing = required.filter((f) => caps.features[f] !== true);
    const approvals = caps.features.run_approval === true || caps.features.run_events_sse === true;
    const expected = config.hermes!.profile;
    const profileMatches = expected ? caps.model === expected : true;
    return NextResponse.json({
      ...status,
      check: {
        reachable: true,
        profileMatches,
        expectedProfile: expected,
        reportedProfile: caps.model,
        missingFeatures: missing,
        approvals,
        ok: profileMatches && missing.length === 0,
      },
    });
  } catch (error: unknown) {
    return NextResponse.json({
      ...status,
      check: {
        reachable: false,
        ok: false,
        error: error instanceof RuntimeError ? error.message : "The Hermes agent could not be reached.",
      },
    });
  }
}
