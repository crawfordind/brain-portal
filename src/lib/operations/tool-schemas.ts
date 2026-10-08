/**
 * Input shapes for the Operations MCP tools, shared by the tool registrations
 * (`src/mcp/tools/operations.ts`) and the documentation catalog
 * (`src/lib/mcp/catalog.ts`), so the two cannot drift.
 *
 * Descriptions are written for an assistant translating plain speech:
 * "move this to waiting on Will" is `set_operational_state` with
 * `kind: "waiting", counterparty: "Will"`.
 */

import { z } from "zod";

const kind = z
  .enum(["action", "decision", "waiting", "commitment"])
  .describe(
    "What the item is: action (a plain task), decision (a choice only the user can make), waiting (someone else owes the next move), commitment (a promise, see direction)"
  );

export const opsFieldsShape = {
  kind: kind.optional(),
  owner: z
    .enum(["me", "other", "system"])
    .nullable()
    .optional()
    .describe("Who moves next. Leave unset to derive it from kind (waiting → other)."),
  counterparty: z
    .string()
    .nullable()
    .optional()
    .describe('Person, org or system involved, as the user said it ("Will", "USDA"). Linked to a contact automatically when exactly one contact has that name.'),
  counterparty_entity_id: z
    .string()
    .nullable()
    .optional()
    .describe("CRM contact id, when you already know it (from search_contacts)."),
  expected_at: z
    .string()
    .nullable()
    .optional()
    .describe("For waiting: the date it was promised or is expected (YYYY-MM-DD)."),
  blocked_by: z
    .string()
    .nullable()
    .optional()
    .describe('What blocks it. "me" means only the user can unblock it. null clears the block.'),
  direction: z
    .enum(["i_owe", "they_owe"])
    .nullable()
    .optional()
    .describe("For commitments: i_owe = the user promised; they_owe = promised to the user."),
  why: z.string().nullable().optional().describe("For decisions: why it matters."),
  options: z.array(z.string()).nullable().optional().describe("For decisions: the options, if known."),
  consequence: z.string().nullable().optional().describe("For decisions: what happens if it is not decided in time."),
};

export const operationsOverviewShape = {};

export const listOperationalItemsShape = {
  view: z
    .enum(["today", "week", "decisions", "waiting", "commitments", "blocked", "blocked_by_me", "all"])
    .default("all")
    .describe(
      "today = overdue or due today and the user's; week = due in the next 7 days; blocked_by_me = blocked with blocked_by 'me' plus open decisions; all = every open item"
    ),
  counterparty: z
    .string()
    .optional()
    .describe('Only items involving this person/org (case-insensitive substring, e.g. "Will", "vendor").'),
  project_id: z.string().optional().describe("Only items in this project."),
  venture_id: z.string().optional().describe("Only items in projects under this venture."),
  due_before: z.string().optional().describe("Only items whose next date is on or before this day (YYYY-MM-DD)."),
  limit: z.number().int().min(1).max(200).default(50),
};

export const setOperationalStateShape = {
  task_id: z.string().describe("The task to change."),
  ...opsFieldsShape,
  status: z
    .enum(["pending", "in_progress", "completed", "cancelled"])
    .optional()
    .describe('"Close that old task" = cancelled; done = completed.'),
  due_date: z.string().nullable().optional().describe("YYYY-MM-DD, or null to clear."),
  project_id: z
    .string()
    .nullable()
    .optional()
    .describe('Move to this project ("make this a Corner Store task"). Find ids with get_portfolio or list_projects.'),
};

export const createOperationalItemShape = {
  title: z.string().min(1).describe("Short statement of the item."),
  description: z.string().optional(),
  project_id: z.string().optional(),
  due_date: z.string().optional().describe("YYYY-MM-DD"),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  ...opsFieldsShape,
};

export const getPortfolioShape = {
  lane_state: z
    .enum(["active", "waiting", "blocked", "future", "reference", "dormant"])
    .optional()
    .describe("Only projects in this lane state (dormant = suggested dormant)."),
};

export const listRelationshipsShape = {
  venture_id: z.string().optional().describe("Only people connected to this venture."),
  name: z.string().optional().describe("Only people whose name contains this text."),
};

export const listIntakeShape = {
  limit: z.number().int().min(1).max(50).default(20),
};

export const triageCaptureShape = {
  capture_id: z.string(),
  action: z
    .enum(["confirm", "file", "dismiss", "reopen"])
    .describe(
      "confirm = create the task/decision/waiting/commitment; file = keep as reference/context; dismiss; reopen = undo any of those. Only confirm when the user asked for it."
    ),
  kind: z
    .enum(["action", "decision", "waiting", "commitment", "reference", "context"])
    .optional()
    .describe("Required for confirm. Defaults to the proposal's kind."),
  title: z.string().optional(),
  due_date: z.string().nullable().optional(),
  project_id: z.string().nullable().optional(),
  counterparty: z.string().nullable().optional(),
  direction: z.enum(["i_owe", "they_owe"]).nullable().optional(),
};

export const getAutomationHealthShape = {
  only_problems: z.boolean().default(false).describe("Only failing or degraded automations."),
};
