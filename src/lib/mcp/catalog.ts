/**
 * Canonical catalog of every MCP capability surfaced by Brain Portal.
 *
 * This file is the single source of truth consumed by:
 *   - GET /api/mcp/docs  (LLM-readable spec)
 *   - the test suite     (asserts the catalog stays in sync with the
 *                         tools / resources / prompts actually registered)
 *
 * Each entry includes:
 *   - identifier        (tool name / resource URI / prompt id)
 *   - human description (short, action-oriented)
 *   - required scope    (the same scope the runtime guard enforces)
 *   - input schema      (zod, converted to JSON Schema in the docs route)
 *
 * When you add a new tool / resource / prompt, add it here too. The
 * `tests/mcp/catalog.test.ts` smoke-test will fail if you forget.
 */

import { z } from "zod";

// ─── Tools ────────────────────────────────────────────────────────────

export interface ToolSpec {
  name: string;
  description: string;
  scope: string;
  category:
    | "notes"
    | "tasks"
    | "projects"
    | "captures"
    | "search"
    | "ai"
    | "crm";
  inputSchema: z.ZodObject<z.ZodRawShape>;
  /** Example arguments (also used in the markdown docs). */
  example?: Record<string, unknown>;
}

export const TOOLS: ToolSpec[] = [
  // ─── Notes ─────────────────────────────────────────────
  {
    name: "list_notes",
    description:
      "List notes with optional filtering by project, type, or full-text search query. Returns titles, IDs, types, and metadata.",
    scope: "notes:read",
    category: "notes",
    inputSchema: z.object({
      project_id: z.string().optional().describe("Filter by project ID"),
      note_type: z
        .enum(["note", "daily", "weekly", "insight", "journal"])
        .optional()
        .describe("Filter by note type"),
      search: z.string().optional().describe("Full-text search query"),
      is_pinned: z.boolean().optional().describe("Filter pinned notes only"),
      limit: z.number().min(1).max(100).default(25).describe("Max results"),
      offset: z.number().min(0).default(0).describe("Pagination offset"),
    }),
    example: { search: "project alpha", limit: 10 },
  },
  {
    name: "get_note",
    description:
      "Get a single note by ID with full content, tags, and connections.",
    scope: "notes:read",
    category: "notes",
    inputSchema: z.object({
      note_id: z.string().describe("The note ID to retrieve"),
      include_connections: z
        .boolean()
        .default(false)
        .describe("Include related note connections"),
    }),
    example: { note_id: "n_abc123", include_connections: true },
  },
  {
    name: "create_note",
    description: "Create a new note. Returns the created note with its ID.",
    scope: "notes:write",
    category: "notes",
    inputSchema: z.object({
      title: z.string().min(1).describe("Note title"),
      content: z.string().describe("Note content (markdown)"),
      note_type: z
        .enum(["note", "daily", "weekly", "insight", "journal"])
        .default("note"),
      project_id: z.string().optional().describe("Assign to a project"),
      is_pinned: z.boolean().default(false),
    }),
    example: { title: "Sprint planning", content: "# Goals\n- ship MCP" },
  },
  {
    name: "update_note",
    description: "Update an existing note's title, content, or metadata.",
    scope: "notes:write",
    category: "notes",
    inputSchema: z.object({
      note_id: z.string().describe("The note ID to update"),
      title: z.string().optional(),
      content: z.string().optional().describe("New content (markdown)"),
      project_id: z.string().optional(),
      is_pinned: z.boolean().optional(),
      is_archived: z.boolean().optional(),
    }),
    example: { note_id: "n_abc123", is_pinned: true },
  },
  {
    name: "delete_note",
    description: "Delete a note by ID. This is irreversible.",
    scope: "notes:write",
    category: "notes",
    inputSchema: z.object({
      note_id: z.string().describe("The note ID to delete"),
    }),
  },

  // ─── Tasks ─────────────────────────────────────────────
  {
    name: "list_tasks",
    description:
      "List tasks with filtering by status, priority, project, or due date.",
    scope: "tasks:read",
    category: "tasks",
    inputSchema: z.object({
      status: z
        .enum(["pending", "in_progress", "completed", "cancelled"])
        .optional(),
      priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
      project_id: z.string().optional(),
      due_before: z.string().optional().describe("YYYY-MM-DD"),
      due_after: z.string().optional().describe("YYYY-MM-DD"),
      limit: z.number().min(1).max(100).default(50),
    }),
    example: { status: "pending", priority: "high" },
  },
  {
    name: "create_task",
    description:
      "Create a new task with content, priority, due date, and optional project assignment.",
    scope: "tasks:write",
    category: "tasks",
    inputSchema: z.object({
      content: z.string().min(1).describe("Task description/content"),
      title: z.string().optional(),
      priority: z
        .enum(["low", "medium", "high", "urgent"])
        .default("medium"),
      due_date: z.string().optional().describe("YYYY-MM-DD"),
      project_id: z.string().optional(),
      tags: z.array(z.string()).optional(),
    }),
    example: {
      content: "Review PR #54",
      priority: "high",
      due_date: "2026-04-20",
    },
  },
  {
    name: "update_task",
    description:
      "Update task status, priority, content, or other fields.",
    scope: "tasks:write",
    category: "tasks",
    inputSchema: z.object({
      task_id: z.string().describe("Task ID to update"),
      content: z.string().optional(),
      status: z
        .enum(["pending", "in_progress", "completed", "cancelled"])
        .optional(),
      priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
      due_date: z.string().optional(),
      project_id: z.string().optional(),
    }),
    example: { task_id: "t_xyz789", status: "completed" },
  },
  {
    name: "delete_task",
    description: "Delete a task by ID. This is irreversible.",
    scope: "tasks:write",
    category: "tasks",
    inputSchema: z.object({
      task_id: z.string().describe("Task ID to delete"),
    }),
  },

  // ─── Projects ──────────────────────────────────────────
  {
    name: "list_projects",
    description:
      "List all projects with their status, note count, and task count.",
    scope: "projects:read",
    category: "projects",
    inputSchema: z.object({
      status: z
        .enum(["active", "planning", "stalled", "completed", "archived"])
        .optional(),
      include_stats: z.boolean().default(true),
    }),
  },
  {
    name: "get_project",
    description:
      "Get detailed project info including description, stats, recent notes, and pending tasks.",
    scope: "projects:read",
    category: "projects",
    inputSchema: z.object({
      project_id: z.string().describe("Project ID"),
    }),
  },
  {
    name: "create_project",
    description:
      "Create a new project with a name, description, and optional status/color.",
    scope: "projects:write",
    category: "projects",
    inputSchema: z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      status: z
        .enum(["active", "planning", "stalled", "completed", "archived"])
        .default("active"),
      color: z.string().optional().describe("Hex color, e.g. #0d9488"),
      parent_id: z.string().optional(),
    }),
  },
  {
    name: "update_project",
    description: "Update project name, description, status, or color.",
    scope: "projects:write",
    category: "projects",
    inputSchema: z.object({
      project_id: z.string(),
      name: z.string().optional(),
      description: z.string().optional(),
      status: z
        .enum(["active", "planning", "stalled", "completed", "archived"])
        .optional(),
      color: z.string().optional(),
    }),
  },

  // ─── Captures ──────────────────────────────────────────
  {
    name: "list_captures",
    description:
      "List recent captures (quick thoughts, ideas, references) with optional type filtering.",
    scope: "captures:read",
    category: "captures",
    inputSchema: z.object({
      capture_type: z
        .enum([
          "thought",
          "idea",
          "followup",
          "task",
          "quote",
          "reference",
          "link",
        ])
        .optional(),
      processed: z.boolean().optional(),
      limit: z.number().min(1).max(100).default(25),
    }),
  },
  {
    name: "create_capture",
    description:
      "Quickly capture a thought, idea, reference, or follow-up item.",
    scope: "captures:write",
    category: "captures",
    inputSchema: z.object({
      content: z.string().min(1),
      capture_type: z
        .enum([
          "thought",
          "idea",
          "followup",
          "task",
          "quote",
          "reference",
          "link",
        ])
        .default("thought"),
      tags: z.array(z.string()).optional(),
      linked_notes: z.array(z.string()).optional(),
      linked_projects: z.array(z.string()).optional(),
    }),
    example: { content: "Idea: weekly digest", capture_type: "idea" },
  },

  // ─── Search ────────────────────────────────────────────
  {
    name: "search",
    description:
      "Full-text search across notes, tasks, captures, and projects via SQLite FTS5.",
    scope: "search:read",
    category: "search",
    inputSchema: z.object({
      query: z.string().min(1),
      entity_types: z
        .array(z.enum(["notes", "tasks", "captures", "projects"]))
        .default(["notes", "tasks", "captures", "projects"]),
      limit: z.number().min(1).max(50).default(20),
    }),
    example: { query: "embeddings", entity_types: ["notes"] },
  },
  {
    name: "recent_activity",
    description:
      "Recent activity feed: modified notes, new tasks, captures, and agent tasks.",
    scope: "search:read",
    category: "search",
    inputSchema: z.object({
      days: z.number().min(1).max(30).default(3),
      limit: z.number().min(1).max(50).default(20),
    }),
  },

  // ─── AI ────────────────────────────────────────────────
  {
    name: "semantic_search",
    description:
      "Find notes semantically similar to a query using AI embeddings. More powerful than keyword search for conceptually related content.",
    scope: "ai:search",
    category: "ai",
    inputSchema: z.object({
      query: z.string().min(1),
      threshold: z.number().min(0).max(1).default(0.5),
      limit: z.number().min(1).max(20).default(10),
    }),
    example: { query: "What did I learn about caching?", threshold: 0.6 },
  },
  {
    name: "generate_insights",
    description:
      "Generate AI insights from recent notes/captures: connections, patterns, gaps, suggestions.",
    scope: "ai:insights",
    category: "ai",
    inputSchema: z.object({
      scope: z.enum(["recent", "project", "all"]).default("recent"),
      project_id: z
        .string()
        .optional()
        .describe("Required when scope is 'project'"),
      days: z.number().min(1).max(90).default(7),
    }),
  },
  {
    name: "delegate_to_agent",
    description:
      "Delegate work to one of 17 specialist AI agents. Use 'auto' to let the router pick the best agent.",
    scope: "ai:delegate",
    category: "ai",
    inputSchema: z.object({
      title: z.string().min(1),
      description: z.string().min(1),
      agent_type: z
        .enum([
          "code",
          "copy",
          "research",
          "marketing",
          "analyst",
          "general",
          "ux",
          "legal",
          "finance",
          "hr",
          "product",
          "sales",
          "operations",
          "security",
          "data_eng",
          "educator",
          "strategy",
          "auto",
        ])
        .default("auto"),
      priority: z
        .enum(["low", "medium", "high", "urgent"])
        .default("medium"),
      context_note_ids: z
        .array(z.string())
        .optional()
        .describe("Note IDs to include as context"),
      source_type: z
        .enum([
          "task",
          "note",
          "capture",
          "reminder",
          "thought",
          "insight",
          "journal",
        ])
        .default("task"),
      source_id: z.string().optional(),
    }),
    example: {
      title: "Draft launch announcement",
      description: "200-word post for our blog announcing v1.0",
      agent_type: "copy",
    },
  },
  {
    name: "get_agent_task",
    description: "Check the status and output of a delegated agent task.",
    scope: "ai:delegate",
    category: "ai",
    inputSchema: z.object({
      agent_task_id: z.string(),
    }),
  },
  {
    name: "list_agent_tasks",
    description: "List delegated agent tasks with optional status filtering.",
    scope: "ai:delegate",
    category: "ai",
    inputSchema: z.object({
      status: z
        .enum([
          "queued",
          "processing",
          "awaiting_review",
          "revision_requested",
          "approved",
          "rejected",
          "failed",
        ])
        .optional(),
      limit: z.number().min(1).max(50).default(20),
    }),
  },

  // ─── CRM ───────────────────────────────────────────────
  {
    name: "search_contacts",
    description:
      "Search CRM contacts (people and organisations) across all ventures. Excludes unresolved event captures unless asked for. Call before answering anything about someone the user works with.",
    scope: "crm:read",
    category: "crm",
    inputSchema: z.object({
      query: z.string().optional().describe("Name fragment to search for"),
      entity_type: z
        .enum(["person", "org", "place", "product", "input", "other"])
        .optional(),
      venture_id: z
        .string()
        .optional()
        .describe("Only contacts with a role at this venture"),
      compartment: z.string().optional().describe("e.g. cannabis"),
      resolution: z
        .enum(["confirmed", "unresolved", "all"])
        .default("confirmed"),
      limit: z.number().min(1).max(100).default(25),
    }),
    example: { query: "northwind", limit: 10 },
  },
  {
    name: "get_contact_brief",
    description:
      "Everything known about one contact: channels, venture roles, compartments, and one timeline merging note mentions with actual touches. The pre-meeting call.",
    scope: "crm:read",
    category: "crm",
    inputSchema: z.object({
      contact_id: z.string().describe("Entity ID of the contact"),
      timeline_limit: z.number().min(1).max(200).default(50),
    }),
    example: { contact_id: "abc123" },
  },
  {
    name: "create_or_merge_contact",
    description:
      "Create a contact, or attach to the existing one if the name resolves. Runs the merge gate: a name matching only after dropping a business suffix creates a separate flagged record rather than silently fusing two companies.",
    scope: "crm:write",
    category: "crm",
    inputSchema: z.object({
      name: z.string(),
      entity_type: z
        .enum(["person", "org", "place", "product", "input", "other"])
        .default("person"),
      unresolved: z
        .boolean()
        .default(false)
        .describe("True for an event capture whose identity is not yet known"),
      met_at: z.string().optional(),
      note: z.string().optional(),
      compartments: z.array(z.string()).optional(),
      email: z.string().optional(),
    }),
    example: { name: "Dana Okonkwo", entity_type: "person" },
  },
  {
    name: "add_contact_channel",
    description:
      "Add an email, phone, handle, URL or address to a contact. An address belongs to only one contact, so a clash is reported rather than overwritten.",
    scope: "crm:write",
    category: "crm",
    inputSchema: z.object({
      contact_id: z.string(),
      kind: z.enum(["email", "phone", "handle", "url", "address"]),
      value: z.string(),
      label: z.string().optional(),
      is_primary: z.boolean().default(false),
    }),
    example: {
      contact_id: "abc123",
      kind: "email",
      value: "dana@northwindfarms.com",
    },
  },
  {
    name: "log_interaction",
    description:
      "Record something that actually passed between the user and a contact: a call, email, meeting or DM. Idempotent, so logging the same touch twice produces one row.",
    scope: "crm:write",
    category: "crm",
    inputSchema: z.object({
      contact_id: z.string().optional(),
      venture_id: z.string().optional(),
      direction: z.enum(["in", "out", "internal"]).default("in"),
      channel: z
        .enum(["email", "call", "sms", "dm", "meeting", "event", "note", "other"])
        .default("note"),
      occurred_at: z.string().optional(),
      subject: z.string().optional(),
      body: z.string().optional(),
      external_id: z.string().optional(),
    }),
    example: {
      contact_id: "abc123",
      channel: "call",
      subject: "Q2 pod preorder",
    },
  },
  {
    name: "set_contact_role",
    description:
      "Attach a contact to a venture in a named role. This is what makes a contact appear when filtering by venture. A contact may hold several roles, at several ventures.",
    scope: "crm:write",
    category: "crm",
    inputSchema: z.object({
      contact_id: z.string(),
      venture_id: z.string(),
      role: z.enum([
        "partner",
        "collaborator",
        "customer_of",
        "member_of",
        "advisor_to",
        "investor_in",
        "employed_by",
        "reports_to",
        "contact_at",
      ]),
      note: z.string().optional(),
    }),
    example: { contact_id: "abc123", venture_id: "def456", role: "customer_of" },
  },
  {
    name: "remove_contact_role",
    description:
      "Remove one role a contact holds at a venture. Other roles, and the contact itself, are untouched.",
    scope: "crm:write",
    category: "crm",
    inputSchema: z.object({
      contact_id: z.string(),
      venture_id: z.string(),
      role: z.enum([
        "partner",
        "collaborator",
        "customer_of",
        "member_of",
        "advisor_to",
        "investor_in",
        "employed_by",
        "reports_to",
        "contact_at",
      ]),
    }),
    example: { contact_id: "abc123", venture_id: "def456", role: "customer_of" },
  },
  {
    name: "list_review_queue",
    description:
      "Contacts awaiting a human decision: unresolved event captures, and possible duplicates the merge gate refused to fuse. Use before bulk-cleaning contacts after an event.",
    scope: "crm:read",
    category: "crm",
    inputSchema: z.object({}),
    example: {},
  },
  {
    name: "resolve_contact",
    description:
      "Act on the review queue: give an unresolved capture its real name, or merge it into an existing contact.",
    scope: "crm:write",
    category: "crm",
    inputSchema: z.object({
      contact_id: z.string(),
      merge_into_id: z.string().optional(),
      confirmed_name: z.string().optional(),
    }),
    example: { contact_id: "abc123", confirmed_name: "Ross Calder" },
  },
  {
    name: "merge_contacts",
    description:
      "Merge one contact into another. Ventures cannot be merged. The venture recorded on past interactions is never changed.",
    scope: "crm:write",
    category: "crm",
    inputSchema: z.object({
      winner_id: z.string().describe("The contact to keep"),
      loser_id: z.string().describe("The contact to fold in and delete"),
    }),
    example: { winner_id: "abc123", loser_id: "def456" },
  },
  {
    name: "list_ventures",
    description:
      "List the user's ventures with contact, product, project and interaction counts, plus their voice and compliance rules. Call at session start to learn which businesses the user runs.",
    scope: "crm:read",
    category: "crm",
    inputSchema: z.object({}),
    example: {},
  },
  {
    name: "list_venture_members",
    description: "The products and projects belonging to one venture.",
    scope: "crm:read",
    category: "crm",
    inputSchema: z.object({ venture_id: z.string() }),
    example: { venture_id: "abc123" },
  },
  {
    name: "create_venture",
    description:
      "Create a venture. An existing entity with that name is adopted, keeping its mention history rather than duplicating it.",
    scope: "crm:write",
    category: "crm",
    inputSchema: z.object({
      name: z.string(),
      voice: z.string().optional(),
      compliance_rules: z.array(z.string()).optional(),
      compartments: z.array(z.string()).optional(),
      sending_email: z.string().optional(),
    }),
    example: { name: "Cedar Line", compliance_rules: ["No health claims."] },
  },
  {
    name: "create_product",
    description:
      "Create a product, optionally attached to a venture. A product belongs to one venture at a time and can be moved later.",
    scope: "crm:write",
    category: "crm",
    inputSchema: z.object({
      name: z.string(),
      venture_id: z.string().optional(),
      sku: z.string().optional(),
    }),
    example: { name: "Eden", venture_id: "abc123" },
  },
  {
    name: "move_to_venture",
    description:
      "Move a product or project to another venture, or detach it with a null venture. Past interactions keep the venture they were logged under.",
    scope: "crm:write",
    category: "crm",
    inputSchema: z.object({
      kind: z.enum(["product", "project"]),
      id: z.string(),
      venture_id: z.string().nullable(),
    }),
    example: { kind: "product", id: "abc123", venture_id: "def456" },
  },
  {
    name: "export_crm",
    description:
      "Export the CRM as JSON or CSV: contacts with channels, roles and compartments, plus interactions. Keeps the user's data portable.",
    scope: "crm:read",
    category: "crm",
    inputSchema: z.object({
      format: z.enum(["json", "csv"]).default("json"),
      include_interactions: z.boolean().default(true),
    }),
    example: { format: "csv" },
  },
];

// ─── Resources ────────────────────────────────────────────────────────

export interface ResourceSpec {
  uri: string;
  description: string;
  scope: string;
  /** True when the URI contains a placeholder (e.g. {noteId}). */
  template?: boolean;
}

export const RESOURCES: ResourceSpec[] = [
  {
    uri: "brain://notes",
    description: "All active notes (titles, types, projects, last updated).",
    scope: "resources:read",
  },
  {
    uri: "brain://notes/{noteId}",
    description: "Full content of a specific note plus its tags.",
    scope: "resources:read",
    template: true,
  },
  {
    uri: "brain://projects",
    description: "All projects with status and note/task counts.",
    scope: "resources:read",
  },
  {
    uri: "brain://tasks",
    description: "All active (non-cancelled) tasks with priority and due dates.",
    scope: "resources:read",
  },
  {
    uri: "brain://daily",
    description: "Today's daily note plus today's captures.",
    scope: "resources:read",
  },
  {
    uri: "brain://agents",
    description: "Available AI agents with their specializations.",
    scope: "resources:read",
  },
  {
    uri: "brain://insights",
    description: "Recent AI-generated insights (connections, patterns, gaps).",
    scope: "resources:read",
  },
  {
    uri: "brain://dashboard",
    description:
      "Dashboard summary: task stats, active projects, deadlines, unread counts.",
    scope: "resources:read",
  },
];

// ─── Prompts ──────────────────────────────────────────────────────────

export interface PromptSpec {
  name: string;
  description: string;
  scope: string;
  inputSchema: z.ZodObject<z.ZodRawShape>;
}

export const PROMPTS: PromptSpec[] = [
  {
    name: "summarize_notes",
    description:
      "Summarize recent notes from Brain Portal, highlighting themes and actionable items.",
    scope: "prompts:read",
    inputSchema: z.object({
      days: z.string().default("7").describe("Days to look back"),
      project_id: z.string().optional(),
    }),
  },
  {
    name: "weekly_review",
    description: "Generate a comprehensive weekly review from Brain Portal data.",
    scope: "prompts:read",
    inputSchema: z.object({}),
  },
  {
    name: "plan_delegation",
    description: "Help plan how to delegate work to Brain Portal's AI agents.",
    scope: "prompts:read",
    inputSchema: z.object({
      task_description: z.string(),
    }),
  },
  {
    name: "brain_dump",
    description:
      "Process a brain dump and organize unstructured thoughts into notes/tasks/captures.",
    scope: "prompts:read",
    inputSchema: z.object({
      text: z.string(),
    }),
  },
];

// ─── Convenience accessors ────────────────────────────────────────────

export function findTool(name: string): ToolSpec | undefined {
  return TOOLS.find((t) => t.name === name);
}

export function findPrompt(name: string): PromptSpec | undefined {
  return PROMPTS.find((p) => p.name === name);
}

export function findResource(uri: string): ResourceSpec | undefined {
  return RESOURCES.find((r) => r.uri === uri);
}
