/**
 * Skill Registry
 *
 * Central registry for all skills in the system. Skills are modular,
 * typed capabilities that can be invoked by heartbeat, agents, users, or API.
 *
 * Built-in skills wrap existing system capabilities (notifications, delegation,
 * processing, AI analysis). Custom skills can be registered at runtime via
 * the database without code changes.
 */

import type { SkillCategory, SkillCostTier } from "@/lib/db/schema";

// ─── Skill Definition Types ─────────────────────────

export interface SkillInputParam {
  type: "string" | "number" | "boolean" | "array" | "object";
  description: string;
  required?: boolean;
  default?: unknown;
  enum?: string[];
}

export interface SkillDefinition {
  /** Unique skill identifier (e.g., "send_notification", "summarize_note") */
  skillId: string;
  name: string;
  description: string;
  category: SkillCategory;
  version: string;
  /** JSON-schema-like input parameter definitions */
  inputSchema: Record<string, SkillInputParam>;
  /** Estimated cost tier for this skill */
  costTier: SkillCostTier;
  /** Whether this skill requires user authentication context */
  requiresAuth: boolean;
  /** Rate limit per hour (0 = unlimited) */
  rateLimitPerHour: number;
  /** Tags for discoverability */
  tags: string[];
}

export interface SkillContext {
  userId: string;
  triggerSource: "manual" | "heartbeat" | "agent" | "api" | "system";
  triggerId?: string;
}

export interface SkillResult {
  success: boolean;
  output: unknown;
  tokensUsed?: number;
  costCents?: number;
}

/** The handler function that executes a skill */
export type SkillHandler = (
  params: Record<string, unknown>,
  context: SkillContext
) => Promise<SkillResult>;

interface RegisteredSkill {
  definition: SkillDefinition;
  handler: SkillHandler;
}

// ─── Registry ────────────────────────────────────────

const registry = new Map<string, RegisteredSkill>();

/**
 * Register a skill in the in-memory registry.
 */
export function registerSkill(
  definition: SkillDefinition,
  handler: SkillHandler
): void {
  if (registry.has(definition.skillId)) {
    console.warn(
      `[SkillRegistry] Overwriting existing skill: ${definition.skillId}`
    );
  }
  registry.set(definition.skillId, { definition, handler });
}

/**
 * Get a registered skill by ID.
 */
export function getSkill(skillId: string): RegisteredSkill | undefined {
  return registry.get(skillId);
}

/**
 * Get all registered skills.
 */
export function getAllSkills(): RegisteredSkill[] {
  return Array.from(registry.values());
}

/**
 * Get skills filtered by category.
 */
export function getSkillsByCategory(category: SkillCategory): RegisteredSkill[] {
  return getAllSkills().filter((s) => s.definition.category === category);
}

/**
 * Check if a skill is registered.
 */
export function hasSkill(skillId: string): boolean {
  return registry.has(skillId);
}

/**
 * Unregister a skill.
 */
export function unregisterSkill(skillId: string): boolean {
  return registry.delete(skillId);
}

/**
 * Get skill definitions only (for API responses).
 */
export function getSkillDefinitions(): SkillDefinition[] {
  return getAllSkills().map((s) => s.definition);
}

/**
 * Validate input params against a skill's input schema.
 */
export function validateSkillInput(
  skillId: string,
  params: Record<string, unknown>
): { valid: boolean; errors: string[] } {
  const skill = getSkill(skillId);
  if (!skill) {
    return { valid: false, errors: [`Skill "${skillId}" not found`] };
  }

  const errors: string[] = [];
  const schema = skill.definition.inputSchema;

  for (const [key, def] of Object.entries(schema)) {
    if (def.required && !(key in params)) {
      errors.push(`Missing required parameter: ${key}`);
      continue;
    }

    if (key in params && params[key] !== undefined) {
      const value = params[key];
      const expectedType = def.type;

      if (expectedType === "array" && !Array.isArray(value)) {
        errors.push(`Parameter "${key}" must be an array`);
      } else if (
        expectedType !== "array" &&
        typeof value !== expectedType
      ) {
        errors.push(
          `Parameter "${key}" must be type ${expectedType}, got ${typeof value}`
        );
      }

      if (def.enum && !def.enum.includes(String(value))) {
        errors.push(
          `Parameter "${key}" must be one of: ${def.enum.join(", ")}`
        );
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
