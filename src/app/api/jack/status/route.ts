import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getJackConfig, publicJackStatus } from "@/lib/agents/jack/config";
import { createJackClient, JackError } from "@/lib/agents/jack/client";
import { rateLimited } from "@/lib/agents/jack/http";

/**
 * GET /api/jack/status — whether delegated tasks can run, in words.
 * `?check=true` also makes one live call to Jack (`/v1/capabilities`) and
 * confirms the endpoint answers, accepts the key, is the expected Hermes
 * profile and supports runs, approvals and stop.
 *
 * Never returns the URL, the key or anything Jack sent beyond those facts.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const config = getJackConfig();
  const status = publicJackStatus(config);
  if (request.nextUrl.searchParams.get("check") !== "true" || config.state !== "ready") {
    return NextResponse.json(status);
  }

  const limited = rateLimited(user.id, "check");
  if (limited) return limited;

  try {
    const caps = await createJackClient(config, { timeoutMs: 8_000 }).capabilities();
    const required = ["run_submission", "run_status", "run_stop"] as const;
    const missing = required.filter((f) => caps.features[f] !== true);
    const approvals = caps.features.run_approval === true || caps.features.run_events_sse === true;
    const profileMatches = caps.model === config.profile;
    return NextResponse.json({
      ...status,
      check: {
        reachable: true,
        profileMatches,
        reportedProfile: caps.model,
        missingFeatures: missing,
        approvals,
        ok: profileMatches && missing.length === 0,
      },
    });
  } catch (error) {
    return NextResponse.json({
      ...status,
      check: {
        reachable: false,
        ok: false,
        error: error instanceof JackError ? error.message : "Jack could not be reached.",
      },
    });
  }
}
