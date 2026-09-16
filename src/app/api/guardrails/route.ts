import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getGuardrails, updateGuardrails } from "@/lib/guardrails/service";
import { compileGuardrails } from "@/lib/guardrails/compiler";

// GET /api/guardrails — fetch user guardrails with compiled preview
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const guardrails = await getGuardrails(user.id);
  const compiled = compileGuardrails(guardrails);

  return NextResponse.json({
    guardrails: {
      personal_context: guardrails.personal_context,
      beliefs: guardrails.beliefs,
      communication_style: guardrails.communication_style,
      topics_to_emphasize: safeParseArray(guardrails.topics_to_emphasize),
      topics_to_avoid: safeParseArray(guardrails.topics_to_avoid),
      custom_instructions: guardrails.custom_instructions,
      learned_context: safeParseObject(guardrails.learned_context),
      is_active: Boolean(guardrails.is_active),
      interaction_count: guardrails.interaction_count,
      evolution_version: guardrails.evolution_version,
      last_evolved_at: guardrails.last_evolved_at,
    },
    compiled_preview: compiled,
  });
}

// PATCH /api/guardrails — update user guardrails
export async function PATCH(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();

  const updated = await updateGuardrails(user.id, {
    personal_context: body.personal_context,
    beliefs: body.beliefs,
    communication_style: body.communication_style,
    topics_to_emphasize: body.topics_to_emphasize,
    topics_to_avoid: body.topics_to_avoid,
    custom_instructions: body.custom_instructions,
    is_active: body.is_active,
  });

  const compiled = compileGuardrails(updated);

  return NextResponse.json({
    guardrails: {
      personal_context: updated.personal_context,
      beliefs: updated.beliefs,
      communication_style: updated.communication_style,
      topics_to_emphasize: safeParseArray(updated.topics_to_emphasize),
      topics_to_avoid: safeParseArray(updated.topics_to_avoid),
      custom_instructions: updated.custom_instructions,
      learned_context: safeParseObject(updated.learned_context),
      is_active: Boolean(updated.is_active),
      interaction_count: updated.interaction_count,
      evolution_version: updated.evolution_version,
      last_evolved_at: updated.last_evolved_at,
    },
    compiled_preview: compiled,
  });
}

function safeParseArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeParseObject(json: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(json);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}
