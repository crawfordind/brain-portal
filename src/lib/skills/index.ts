/**
 * Skills Architecture - Public API
 *
 * Initialize with `initializeSkills()` during app startup.
 * Execute skills with `executeSkill()`.
 * Query the registry with `getSkillDefinitions()`, `getSkill()`, etc.
 */

export {
  registerSkill,
  getSkill,
  getAllSkills,
  getSkillsByCategory,
  hasSkill,
  unregisterSkill,
  getSkillDefinitions,
  validateSkillInput,
  type SkillDefinition,
  type SkillContext,
  type SkillResult,
  type SkillHandler,
  type SkillInputParam,
} from "./registry";

export {
  executeSkill,
  getSkillExecutions,
  type ExecuteSkillOptions,
  type ExecuteSkillResult,
} from "./executor";

import { registerBuiltinSkills } from "./builtins";
export { registerBuiltinSkills };

let initialized = false;

/**
 * Initialize the skills system. Safe to call multiple times.
 */
export function initializeSkills(): void {
  if (initialized) return;
  initialized = true;
  registerBuiltinSkills();
}
