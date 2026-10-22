import type { Metadata } from "next";
import { getSignupMode } from "@/lib/auth/signup-policy";
import { parseAiKeyPolicy } from "@/lib/ai/credentials/types";
import { PROMPTS, RESOURCES, TOOLS } from "@/lib/mcp/catalog";
import { WaitlistLanding } from "@/components/waitlist/waitlist-landing";

/**
 * The public front door: where `/` sends anyone without a session.
 *
 * A server component so the page can tell the truth about this deployment:
 * MCP counts come from the catalog the server registers (the old page said
 * 38 when there were 52), and an instance with open signups offers a sign-up
 * instead of a waitlist that nobody reviews. The copy itself lives in
 * `src/lib/waitlist/content.ts`, where every claim names the code behind it.
 */

// SIGNUP_MODE and SOURCE_CODE_URL are runtime settings; a static render would
// freeze whatever the build machine had.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Brain Portal: capture it, find it, put AI to work on it",
  description:
    "An open-source workspace for notes, tasks, projects and people, with an AI that starts from what you wrote. Join the early access list.",
  openGraph: {
    title: "Brain Portal",
    description:
      "Capture anything in one box, find it by meaning, and put an AI to work on it. Open source under AGPL-3.0.",
    type: "website",
  },
};

/** Upstream source. A fork running a modified copy should point this at itself (AGPL §13). */
const DEFAULT_SOURCE_URL = "https://github.com/crawfordind/brain-portal";

function sourceUrl(): string {
  const configured = process.env.SOURCE_CODE_URL?.trim().replace(/\/+$/, "");
  return configured && /^https?:\/\//i.test(configured) ? configured : DEFAULT_SOURCE_URL;
}

/** Tools shown in the MCP example, kept only if the catalog still has them. */
const EXAMPLE_TOOLS = ["semantic_search", "create_capture", "list_tasks", "get_contact_brief", "delegate_to_agent"];

export default function WaitlistPage() {
  const toolNames = new Set(TOOLS.map((t) => t.name));
  return (
    <WaitlistLanding
      signupOpen={getSignupMode() === "open"}
      personalKeys={parseAiKeyPolicy(process.env.AI_KEY_POLICY) !== "server_only"}
      sourceUrl={sourceUrl()}
      mcp={{
        tools: TOOLS.length,
        resources: RESOURCES.length,
        prompts: PROMPTS.length,
        examples: EXAMPLE_TOOLS.filter((name) => toolNames.has(name)),
      }}
    />
  );
}
