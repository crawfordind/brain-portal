/**
 * Guardrails Module
 *
 * User-defined AI interaction profile: identity, beliefs, style, and boundaries.
 * Compiles into a compact prompt fragment injected into every LLM call.
 * Self-evolves by learning from interaction patterns over time.
 */

export { getGuardrails, updateGuardrails, incrementInteractionCount } from "./service";
export { compileGuardrails, injectGuardrails } from "./compiler";
export { maybeEvolve, forceEvolve } from "./evolution";
export type { UserGuardrails, GuardrailsInput } from "./service";

/**
 * One-call helper: fetch guardrails, compile, and return the prompt fragment.
 * Use this in hot paths (chat, agent execution) for minimal boilerplate.
 */
export async function getCompiledGuardrails(userId: string): Promise<string> {
  const { getGuardrails: get } = await import("./service");
  const { compileGuardrails: compile } = await import("./compiler");

  const guardrails = await get(userId);
  return compile(guardrails);
}
