/**
 * Built-in Skills
 *
 * These skills wrap existing system capabilities into the skills architecture.
 * Each skill is self-contained with its definition and handler function.
 *
 * Skills registered here are available immediately without database entries.
 */

import { registerSkill } from "./registry";
import type { SkillHandler, SkillDefinition } from "./registry";
import { createNotification } from "@/lib/notifications/engine";
import { db, mutate, queryAll, queryOne } from "@/lib/db/client";
import { complete, completeJSON } from "@/lib/ai/client";
import { executeAgentTask } from "@/lib/agents/executor";
import type { DelegationSourceType } from "@/lib/db/schema";
import { manageTableDef, manageTableHandler } from "./table";

// ─── send_notification ───────────────────────────────

const sendNotificationDef: SkillDefinition = {
  skillId: "send_notification",
  name: "Send Notification",
  description:
    "Create an in-app notification for the user. Supports priority levels and entity linking.",
  category: "notification",
  version: "1.0.0",
  inputSchema: {
    title: {
      type: "string",
      description: "Notification title",
      required: true,
    },
    body: {
      type: "string",
      description: "Notification body text",
      required: true,
    },
    priority: {
      type: "string",
      description: "Notification priority",
      enum: ["low", "medium", "high", "urgent"],
      default: "medium",
    },
    type: {
      type: "string",
      description: "Notification type",
      default: "system",
    },
    entity_type: {
      type: "string",
      description: "Related entity type (e.g., task, note, project)",
    },
    entity_id: {
      type: "string",
      description: "Related entity ID",
    },
  },
  costTier: "free",
  requiresAuth: true,
  rateLimitPerHour: 30,
  tags: ["notification", "alert", "messaging"],
};

const sendNotificationHandler: SkillHandler = async (params, context) => {
  const notifId = await createNotification({
    userId: context.userId,
    type: (params.type as "system") || "system",
    title: params.title as string,
    body: params.body as string,
    priority: (params.priority as "low" | "medium" | "high" | "urgent") || "medium",
    entityType: (params.entity_type as string) || undefined,
    entityId: (params.entity_id as string) || undefined,
    metadata: {
      trigger_source: context.triggerSource,
      trigger_id: context.triggerId,
    },
  });

  return {
    success: !!notifId,
    output: notifId
      ? { notification_id: notifId, deduplicated: false }
      : { notification_id: null, deduplicated: true },
  };
};

// ─── delegate_to_agent ───────────────────────────────

const delegateToAgentDef: SkillDefinition = {
  skillId: "delegate_to_agent",
  name: "Delegate to AI Agent",
  description:
    "Create an agent task and dispatch it to a specialized AI agent for processing.",
  category: "delegation",
  version: "1.0.0",
  inputSchema: {
    title: {
      type: "string",
      description: "Task title",
      required: true,
    },
    description: {
      type: "string",
      description: "Task description / instructions",
      required: true,
    },
    agent_type: {
      type: "string",
      description: "Which agent to assign (use 'auto' for smart routing)",
      enum: ["auto", "code", "copy", "research", "marketing", "analyst", "general", "ux", "legal", "finance", "hr", "product", "sales", "operations", "security", "data_eng", "educator", "strategy"],
      default: "auto",
    },
    source_type: {
      type: "string",
      description: "Source entity type",
      enum: ["task", "note", "capture", "reminder", "thought", "insight"],
      default: "task",
    },
    source_id: {
      type: "string",
      description: "Source entity ID",
    },
    output_format: {
      type: "string",
      description: "Desired output format",
      enum: ["markdown", "code", "plain_text", "structured"],
      default: "markdown",
    },
    auto_execute: {
      type: "boolean",
      description: "Whether to immediately execute the agent task",
      default: true,
    },
  },
  costTier: "high",
  requiresAuth: true,
  rateLimitPerHour: 20,
  tags: ["agent", "ai", "delegation", "llm"],
};

const delegateToAgentHandler: SkillHandler = async (params, context) => {
  let agentType = (params.agent_type as string) || "auto";
  const title = params.title as string;
  const description = params.description as string;
  const sourceType = (params.source_type as string) || "task";
  const sourceId = (params.source_id as string) || null;
  const outputFormat = (params.output_format as string) || "markdown";
  const autoExecute = params.auto_execute !== false;
  const routedBy: string = "user";

  // The keyword router is gone with the delegation UI it served. A caller that
  // wants a specialist names one; "auto" now means the generalist rather than
  // a guess made from keyword counts.
  if (agentType === "auto") {
    agentType = "general";
  }

  // Only delegate to an agent that actually has a config row — the executor
  // hard-fails on a missing config, which would turn this into a failed task.
  const agentConfig = await queryOne<{ agent_type: string }>(
    `SELECT agent_type FROM agent_configs WHERE agent_type = ? AND is_active = TRUE`,
    [agentType]
  );
  if (!agentConfig) {
    const fallback = await queryOne<{ agent_type: string }>(
      `SELECT agent_type FROM agent_configs
       WHERE is_active = TRUE
       ORDER BY CASE WHEN agent_type = 'general' THEN 0 ELSE 1 END
       LIMIT 1`
    );
    if (!fallback) {
      return { success: false, output: { error: "No active agents are configured" } };
    }
    agentType = fallback.agent_type;
  }

  // Create the agent task. The id comes back via RETURNING — the previous
  // "SELECT ... ORDER BY created_at DESC LIMIT 1" read-back could return a
  // different task entirely, since created_at only has second resolution and
  // ties break arbitrarily.
  const agentTask = await mutate<{ id: string }>(
    `INSERT INTO agent_tasks
          (user_id, title, description, task_type, assigned_agent, status, priority, output_format, source_type, source_id, context_note_ids, context_urls, routed_by)
          VALUES (?, ?, ?, ?, ?, 'queued', 'medium', ?, ?, ?, '[]', '[]', ?)
          RETURNING id`,
    [
      context.userId,
      title,
      description,
      agentType,
      agentType,
      outputFormat,
      sourceType,
      sourceId,
      routedBy,
    ]
  );

  if (!agentTask) {
    return { success: false, output: { error: "Failed to create agent task" } };
  }

  // Execute immediately if requested
  if (autoExecute) {
    // Fire and forget — don't block the skill execution
    executeAgentTask(agentTask.id).catch((err) => {
      console.error(`[Skill:delegate_to_agent] Execution failed:`, err);
    });
  }

  return {
    success: true,
    output: {
      agent_task_id: agentTask.id,
      agent_type: agentType,
      routed_by: routedBy,
      auto_executed: autoExecute,
    },
  };
};

// ─── summarize_content ───────────────────────────────

const summarizeContentDef: SkillDefinition = {
  skillId: "summarize_content",
  name: "Summarize Content",
  description:
    "Generate a concise summary of provided text content using AI.",
  category: "analysis",
  version: "1.0.0",
  inputSchema: {
    content: {
      type: "string",
      description: "The text content to summarize",
      required: true,
    },
    max_length: {
      type: "number",
      description: "Maximum summary length in sentences",
      default: 3,
    },
    style: {
      type: "string",
      description: "Summary style",
      enum: ["concise", "detailed", "bullet_points"],
      default: "concise",
    },
  },
  costTier: "low",
  requiresAuth: true,
  rateLimitPerHour: 60,
  tags: ["ai", "summary", "content", "analysis"],
};

const summarizeContentHandler: SkillHandler = async (params, context) => {
  const content = params.content as string;
  const maxLength = (params.max_length as number) || 3;
  const style = (params.style as string) || "concise";

  const styleInstructions: Record<string, string> = {
    concise: `Summarize in ${maxLength} sentence(s). Be direct and informative.`,
    detailed: `Provide a thorough summary in ${maxLength} sentences. Cover key points and nuances.`,
    bullet_points: `Summarize as ${maxLength} bullet points. Each should be a complete thought.`,
  };

  const truncated = content.substring(0, 8000);
  const prompt = `${styleInstructions[style] || styleInstructions.concise}\n\nContent:\n${truncated}`;

  const summary = await complete(prompt, {
    slot: "fast",
    userId: context.userId,
    maxTokens: 500,
    temperature: 0.3,
  });

  const tokensUsed = Math.ceil((prompt.length + summary.length) / 4);

  return {
    success: true,
    output: { summary: summary.trim() },
    tokensUsed,
    costCents: tokensUsed * 0.000003 * 100,
  };
};

// ─── find_related_notes ──────────────────────────────

const findRelatedNotesDef: SkillDefinition = {
  skillId: "find_related_notes",
  name: "Find Related Notes",
  description:
    "Find notes related to a given note or text query using semantic search.",
  category: "analysis",
  version: "1.0.0",
  inputSchema: {
    note_id: {
      type: "string",
      description: "Note ID to find relations for",
    },
    query: {
      type: "string",
      description: "Text query to find related notes (alternative to note_id)",
    },
    limit: {
      type: "number",
      description: "Maximum number of related notes to return",
      default: 5,
    },
  },
  costTier: "low",
  requiresAuth: true,
  rateLimitPerHour: 60,
  tags: ["search", "notes", "semantic", "connections"],
};

const findRelatedNotesHandler: SkillHandler = async (params, context) => {
  const noteId = params.note_id as string | undefined;
  const limit = (params.limit as number) || 5;

  if (!noteId) {
    return { success: false, output: { error: "note_id is required" } };
  }

  // Get the note's embedding
  const embedding = await queryOne<{ embedding: string }>(
    `SELECT embedding FROM embeddings WHERE entity_type = 'note' AND entity_id = ?`,
    [noteId]
  );

  if (!embedding) {
    return {
      success: true,
      output: { notes: [], message: "No embedding found for this note" },
    };
  }

  // Find similar notes by comparing embeddings
  const allEmbeddings = await queryAll<{
    entity_id: string;
    embedding: string;
  }>(
    `SELECT entity_id, embedding FROM embeddings
     WHERE entity_type = 'note' AND entity_id != ?
     AND user_id = ?`,
    [noteId, context.userId]
  );

  const sourceVec = JSON.parse(embedding.embedding) as number[];
  const scored = allEmbeddings
    .map((e) => {
      const vec = JSON.parse(e.embedding) as number[];
      const similarity = cosineSimilarity(sourceVec, vec);
      return { entity_id: e.entity_id, similarity };
    })
    .filter((s) => s.similarity > 0.6)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);

  // Fetch note details
  const relatedNotes = [];
  for (const match of scored) {
    const note = await queryOne<{ id: string; title: string; content_plain: string }>(
      `SELECT id, title, content_plain FROM notes WHERE id = ?`,
      [match.entity_id]
    );
    if (note) {
      relatedNotes.push({
        id: note.id,
        title: note.title,
        preview: note.content_plain?.substring(0, 200) || "",
        similarity: Math.round(match.similarity * 1000) / 1000,
      });
    }
  }

  return {
    success: true,
    output: { notes: relatedNotes, count: relatedNotes.length },
  };
};

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
}

// ─── enqueue_processing ──────────────────────────────

const enqueueProcessingDef: SkillDefinition = {
  skillId: "enqueue_processing",
  name: "Enqueue Processing Job",
  description:
    "Add items to the background processing queue for embedding generation, summarization, etc.",
  category: "processing",
  version: "1.0.0",
  inputSchema: {
    entity_type: {
      type: "string",
      description: "Entity type to process",
      required: true,
    },
    entity_id: {
      type: "string",
      description: "Entity ID to process",
      required: true,
    },
    operation: {
      type: "string",
      description: "Processing operation",
      required: true,
      enum: [
        "generate_embedding",
        "generate_summary",
        "generate_tags",
        "find_connections",
        "analyze_capture",
        "scan_for_tasks",
      ],
    },
    tier: {
      type: "string",
      description: "Processing tier (determines cost/speed)",
      enum: ["local", "embedding", "fast_llm", "full_llm"],
      default: "embedding",
    },
    priority: {
      type: "number",
      description: "Job priority (higher = processed first)",
      default: 0,
    },
  },
  costTier: "low",
  requiresAuth: true,
  rateLimitPerHour: 120,
  tags: ["processing", "queue", "background", "embedding"],
};

const enqueueProcessingHandler: SkillHandler = async (params, context) => {
  const entityType = params.entity_type as string;
  const entityId = params.entity_id as string;
  const operation = params.operation as string;
  const tier = (params.tier as string) || "embedding";
  const priority = (params.priority as number) || 0;

  // Check for duplicate
  const existing = await queryOne(
    `SELECT id FROM processing_queue
     WHERE entity_id = ? AND operation = ? AND status IN ('pending', 'processing')`,
    [entityId, operation]
  );

  if (existing) {
    return {
      success: true,
      output: { enqueued: false, reason: "duplicate", existing_id: (existing as { id: string }).id },
    };
  }

  await db.execute({
    sql: `INSERT INTO processing_queue
          (user_id, entity_type, entity_id, operation, tier, priority)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [context.userId, entityType, entityId, operation, tier, priority],
  });

  return {
    success: true,
    output: { enqueued: true, entity_id: entityId, operation },
  };
};

// ─── generate_insights ───────────────────────────────

const generateInsightsDef: SkillDefinition = {
  skillId: "generate_insights",
  name: "Generate Insights",
  description:
    "Analyze recent notes and captures to generate AI-powered insights, patterns, and connections.",
  category: "analysis",
  version: "1.0.0",
  inputSchema: {
    scope: {
      type: "string",
      description: "Analysis scope",
      enum: ["recent", "project", "all"],
      default: "recent",
    },
    project_id: {
      type: "string",
      description: "Project ID (required if scope is 'project')",
    },
    days: {
      type: "number",
      description: "Number of days to look back (for 'recent' scope)",
      default: 7,
    },
  },
  costTier: "medium",
  requiresAuth: true,
  rateLimitPerHour: 10,
  tags: ["ai", "insights", "analysis", "patterns"],
};

const generateInsightsHandler: SkillHandler = async (params, context) => {
  const scope = (params.scope as string) || "recent";
  const days = (params.days as number) || 7;
  const projectId = params.project_id as string | undefined;

  let notes: { id: string; title: string; content_plain: string }[];

  if (scope === "project" && projectId) {
    notes = await queryAll(
      `SELECT id, title, content_plain FROM notes
       WHERE user_id = ? AND project_id = ? AND content_plain IS NOT NULL
       ORDER BY updated_at DESC LIMIT 20`,
      [context.userId, projectId]
    );
  } else {
    notes = await queryAll(
      `SELECT id, title, content_plain FROM notes
       WHERE user_id = ? AND content_plain IS NOT NULL
         AND datetime(updated_at) > datetime('now', '-' || ? || ' days')
       ORDER BY updated_at DESC LIMIT 20`,
      [context.userId, days]
    );
  }

  if (notes.length === 0) {
    return {
      success: true,
      output: { insights: [], message: "No recent content to analyze" },
    };
  }

  const { INSIGHT_SYSTEM_PROMPT, INSIGHT_GENERATION_PROMPT } = await import("@/lib/ai/prompts");

  const contextData = {
    recentNotes: notes.map((n) => ({
      id: n.id,
      title: n.title,
      content: (n.content_plain || "").substring(0, 800),
    })),
  };
  const contextStr = JSON.stringify(contextData, null, 2);
  const prompt = INSIGHT_GENERATION_PROMPT.replace("{context}", contextStr);

  interface RawInsight {
    type: string;
    title: string;
    content: string;
    source_notes?: string[];
  }
  interface InsightResponse {
    connections?: RawInsight[];
    patterns?: RawInsight[];
    gaps?: RawInsight[];
    leverage?: RawInsight[];
    questions?: RawInsight[];
  }

  const response = await completeJSON<InsightResponse>(prompt, {
    system: INSIGHT_SYSTEM_PROMPT,
    maxTokens: 1500,
  });

  const insights: Array<{ title: string; content: string; type: string; source_notes?: string[] }> = [];
  const flatten = (items: RawInsight[] | undefined, type: string) => {
    if (!items) return;
    for (const item of items) {
      insights.push({ title: item.title, content: item.content, type, source_notes: item.source_notes });
    }
  };
  flatten(response.connections, "connection");
  flatten(response.patterns, "pattern");
  flatten(response.gaps, "gap");
  flatten(response.leverage, "leverage");
  flatten(response.questions, "question");

  const tokensUsed = Math.ceil(prompt.length / 4) + Math.ceil(JSON.stringify(response).length / 4);

  return {
    success: true,
    output: { insights },
    tokensUsed,
    costCents: tokensUsed * 0.00003 * 100,
  };
};

// ─── daily_digest ────────────────────────────────────

const dailyDigestDef: SkillDefinition = {
  skillId: "daily_digest",
  name: "Generate Daily Digest",
  description:
    "Compile a summary of the day's activity: tasks completed, notes created, upcoming deadlines.",
  category: "content",
  version: "1.0.0",
  inputSchema: {
    date: {
      type: "string",
      description: "Date to generate digest for (YYYY-MM-DD). Defaults to today.",
    },
    include_ai_summary: {
      type: "boolean",
      description: "Whether to include AI-generated summary",
      default: true,
    },
  },
  costTier: "low",
  requiresAuth: true,
  rateLimitPerHour: 5,
  tags: ["digest", "summary", "daily", "productivity"],
};

const dailyDigestHandler: SkillHandler = async (params, context) => {
  const date = (params.date as string) || new Date().toISOString().split("T")[0];
  const includeAi = params.include_ai_summary !== false;

  // Gather day's activity
  const [tasksCompleted, tasksCreated, notesCreated, capturesCreated, upcomingDeadlines] =
    await Promise.all([
      queryAll<{ id: string; title: string; content: string }>(
        `SELECT id, title, content FROM tasks
         WHERE user_id = ? AND completed_at LIKE ? || '%'`,
        [context.userId, date]
      ),
      queryAll<{ id: string; title: string; content: string }>(
        `SELECT id, title, content FROM tasks
         WHERE user_id = ? AND created_at LIKE ? || '%' AND status != 'completed'`,
        [context.userId, date]
      ),
      queryAll<{ id: string; title: string }>(
        `SELECT id, title FROM notes
         WHERE user_id = ? AND created_at LIKE ? || '%'`,
        [context.userId, date]
      ),
      queryAll<{ id: string; content: string }>(
        `SELECT id, content FROM captures
         WHERE user_id = ? AND created_at LIKE ? || '%'`,
        [context.userId, date]
      ),
      queryAll<{ id: string; title: string; content: string; due_date: string }>(
        `SELECT id, title, content, due_date FROM tasks
         WHERE user_id = ? AND status IN ('pending', 'in_progress')
           AND due_date BETWEEN ? AND date(?, '+3 days')`,
        [context.userId, date, date]
      ),
    ]);

  const digest = {
    date,
    stats: {
      tasks_completed: tasksCompleted.length,
      tasks_created: tasksCreated.length,
      notes_created: notesCreated.length,
      captures: capturesCreated.length,
      upcoming_deadlines: upcomingDeadlines.length,
    },
    tasks_completed: tasksCompleted.map((t) => ({
      id: t.id,
      title: t.title || t.content,
    })),
    upcoming_deadlines: upcomingDeadlines.map((t) => ({
      id: t.id,
      title: t.title || t.content,
      due_date: t.due_date,
    })),
    ai_summary: null as string | null,
  };

  if (includeAi && (tasksCompleted.length > 0 || notesCreated.length > 0)) {
    try {
      const summaryPrompt = `Generate a 2-3 sentence daily productivity summary for ${date}:
- ${tasksCompleted.length} tasks completed: ${tasksCompleted.map((t) => t.title || t.content).join(", ") || "none"}
- ${notesCreated.length} notes created: ${notesCreated.map((n) => n.title).join(", ") || "none"}
- ${capturesCreated.length} quick captures
- ${upcomingDeadlines.length} upcoming deadlines

Be direct and specific. State what actually moved forward and flag anything that looks stalled or time-sensitive. No cheerleading.`;

      digest.ai_summary = await complete(summaryPrompt, {
        slot: "fast",
        userId: context.userId,
        maxTokens: 200,
        temperature: 0.5,
      });
    } catch (err) {
      console.warn("[Skill:daily_digest] AI summary failed:", err);
    }
  }

  return { success: true, output: digest };
};

// ─── auto_triage_captures ───────────────────────────

const autoTriageCapturesDef: SkillDefinition = {
  skillId: "auto_triage_captures",
  name: "Auto-Triage Captures",
  description:
    "Automatically classify and convert unprocessed captures into the right entity types (tasks, notes, reminders). Links to projects, suggests agent delegation, and marks captures as processed. Turns a passive inbox into an active processing pipeline.",
  category: "processing",
  version: "1.0.0",
  inputSchema: {
    max_items: {
      type: "number",
      description: "Maximum number of captures to triage in one batch",
      default: 10,
    },
    auto_delegate: {
      type: "boolean",
      description: "Whether to auto-delegate items with a suggested agent",
      default: false,
    },
    dry_run: {
      type: "boolean",
      description: "Preview triage results without making changes",
      default: false,
    },
  },
  costTier: "medium",
  requiresAuth: true,
  rateLimitPerHour: 6,
  tags: ["triage", "captures", "inbox", "processing", "automation", "productivity"],
};

const autoTriageCapturesHandler: SkillHandler = async (params, context) => {
  const maxItems = (params.max_items as number) || 10;
  const autoDelegate = params.auto_delegate === true;
  const dryRun = params.dry_run === true;

  // 1. Fetch unprocessed captures
  const captures = await queryAll<{
    id: string;
    content: string;
    capture_type: string;
    tags: string;
    metadata: string;
    created_at: string;
  }>(
    `SELECT id, content, capture_type, tags, metadata, created_at
     FROM captures
     WHERE user_id = ? AND processed = FALSE
     ORDER BY created_at ASC
     LIMIT ?`,
    [context.userId, maxItems]
  );

  if (captures.length === 0) {
    return {
      success: true,
      output: {
        triaged: 0,
        message: "No unprocessed captures found. Inbox zero!",
        results: [],
      },
    };
  }

  // 2. Get context for classification
  const [activeProjects, recentItems] = await Promise.all([
    queryAll<{ slug: string; name: string; id: string }>(
      "SELECT id, slug, name FROM projects WHERE user_id = ? AND status = 'active' LIMIT 10",
      [context.userId]
    ),
    queryAll<{ type: string; title: string }>(
      `SELECT 'task' as type, COALESCE(title, content) as title FROM tasks WHERE user_id = ? ORDER BY created_at DESC LIMIT 5
       UNION ALL
       SELECT 'note' as type, title FROM notes WHERE user_id = ? ORDER BY updated_at DESC LIMIT 5`,
      [context.userId, context.userId]
    ),
  ]);

  const hour = new Date().getHours();
  const timeOfDay = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";

  // The classifier's suggested agent is free-form LLM output. Anything not in
  // this set violates the assigned_agent CHECK constraint (or has no config for
  // the executor to load), so it is dropped rather than silently delegated.
  const activeAgentTypes = new Set(
    (
      await queryAll<{ agent_type: string }>(
        "SELECT agent_type FROM agent_configs WHERE is_active = TRUE"
      )
    ).map((a) => a.agent_type)
  );

  // 3. Classify each capture
  const { classifyIntent } = await import("@/lib/stream/classifier");
  const { v4: uuid } = await import("uuid");

  const results: Array<{
    captureId: string;
    originalContent: string;
    classifiedAs: string;
    title: string;
    confidence: number;
    convertedTo: string | null;
    newEntityId: string | null;
    projectMatch: string | null;
    agentSuggested: string | null;
    agentDelegated: boolean;
    reasoning: string;
  }> = [];

  let triaged = 0;
  let converted = 0;
  let delegated = 0;
  let totalTokens = 0;

  for (const capture of captures) {
    try {
      const classification = await classifyIntent(capture.content, {
        activeProjects: activeProjects.map((p) => ({ slug: p.slug, name: p.name })),
        recentItems,
        timeOfDay,
      });

      // Resolve project ID from slug
      let projectId: string | null = null;
      if (classification.projectSlug) {
        const project = activeProjects.find(
          (p) => p.slug === classification.projectSlug
        );
        if (project) projectId = project.id;
      }

      const result: (typeof results)[number] = {
        captureId: capture.id,
        originalContent: capture.content.slice(0, 100),
        classifiedAs: classification.type,
        title: classification.title || capture.content.slice(0, 60),
        confidence: classification.confidence,
        convertedTo: null,
        newEntityId: null,
        projectMatch: classification.projectSlug || null,
        agentSuggested: classification.suggestedAgent || null,
        agentDelegated: false,
        reasoning: classification.reasoning || "",
      };

      if (!dryRun) {
        const newId = uuid();

        // Convert based on classification type
        switch (classification.type) {
          case "task": {
            await db.execute({
              sql: `INSERT INTO tasks (id, user_id, content, title, description, priority, due_date, tags, project_id, metadata)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              args: [
                newId,
                context.userId,
                capture.content,
                classification.title || capture.content.slice(0, 60),
                capture.content,
                classification.priority || "medium",
                classification.dueDate || null,
                JSON.stringify(classification.tags || []),
                projectId,
                JSON.stringify({
                  triaged_from_capture: capture.id,
                  classification,
                  triage_source: context.triggerSource,
                }),
              ],
            });
            result.convertedTo = "task";
            result.newEntityId = newId;
            converted++;
            break;
          }

          case "note":
          case "question":
          case "decision": {
            const slug = (classification.title || capture.content.slice(0, 40))
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-|-$/g, "")
              .slice(0, 60);

            await db.execute({
              sql: `INSERT INTO notes (id, user_id, title, slug, content, content_plain, auto_tags, project_id, note_type, metadata)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              args: [
                newId,
                context.userId,
                classification.title || capture.content.slice(0, 60),
                slug + "-" + newId.slice(0, 6),
                capture.content,
                capture.content,
                JSON.stringify(classification.tags || []),
                projectId,
                classification.type === "note" ? "standard" : classification.type,
                JSON.stringify({
                  triaged_from_capture: capture.id,
                  classification,
                  triage_source: context.triggerSource,
                }),
              ],
            });
            result.convertedTo = "note";
            result.newEntityId = newId;
            converted++;
            break;
          }

          case "reminder": {
            await db.execute({
              sql: `INSERT INTO reminders (id, user_id, title, content, priority, remind_at, tags, project_id, metadata)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              args: [
                newId,
                context.userId,
                classification.title || capture.content.slice(0, 60),
                capture.content,
                classification.priority || "medium",
                classification.dueDate || null,
                JSON.stringify(classification.tags || []),
                projectId,
                JSON.stringify({
                  triaged_from_capture: capture.id,
                  classification,
                  triage_source: context.triggerSource,
                }),
              ],
            });
            result.convertedTo = "reminder";
            result.newEntityId = newId;
            converted++;
            break;
          }

          default: {
            // thought, reference, capture — leave as capture but update tags/metadata
            await db.execute({
              sql: `UPDATE captures SET
                      tags = ?,
                      metadata = json_set(COALESCE(metadata, '{}'), '$.classification', ?)
                    WHERE id = ?`,
              args: [
                JSON.stringify(classification.tags || []),
                JSON.stringify(classification),
                capture.id,
              ],
            });
            result.convertedTo = "enriched_capture";
            break;
          }
        }

        // Auto-delegate if requested and an agent was suggested
        if (
          autoDelegate &&
          classification.suggestedAgent &&
          activeAgentTypes.has(classification.suggestedAgent) &&
          result.newEntityId &&
          (classification.type === "task" || classification.type === "note")
        ) {
          try {
            const agentTaskId = uuid();
            const sourceType = classification.type as DelegationSourceType;

            await db.execute({
              sql: `INSERT INTO agent_tasks
                    (id, user_id, title, description, task_type, assigned_agent, status, priority, source_type, source_id, routed_by, context_note_ids, context_urls)
                    VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, 'auto_rule', '[]', '[]')`,
              args: [
                agentTaskId,
                context.userId,
                classification.title || capture.content.slice(0, 60),
                capture.content,
                classification.suggestedAgent,
                classification.suggestedAgent,
                classification.priority || "medium",
                sourceType,
                result.newEntityId,
              ],
            });

            // Update the task with agent delegation info
            if (classification.type === "task") {
              await db.execute({
                sql: `UPDATE tasks SET delegated_to = ?, agent_task_id = ? WHERE id = ?`,
                args: [classification.suggestedAgent, agentTaskId, result.newEntityId],
              });
            }

            result.agentDelegated = true;
            delegated++;

            // Fire and forget execution
            executeAgentTask(agentTaskId).catch((err) => {
              console.error(`[Skill:auto_triage] Agent execution failed for ${agentTaskId}:`, err);
            });
          } catch (delegateErr) {
            console.warn(`[Skill:auto_triage] Delegation failed for capture ${capture.id}:`, delegateErr);
          }
        }

        // Mark original capture as processed
        await db.execute({
          sql: `UPDATE captures SET processed = TRUE WHERE id = ?`,
          args: [capture.id],
        });
      }

      results.push(result);
      triaged++;

      // Rough token estimate for cost tracking
      totalTokens += Math.ceil(capture.content.length / 4) + 128;
    } catch (err) {
      console.error(`[Skill:auto_triage] Failed to triage capture ${capture.id}:`, err);
      results.push({
        captureId: capture.id,
        originalContent: capture.content.slice(0, 100),
        classifiedAs: "error",
        title: "",
        confidence: 0,
        convertedTo: null,
        newEntityId: null,
        projectMatch: null,
        agentSuggested: null,
        agentDelegated: false,
        reasoning: `Error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  const costCents = totalTokens * 0.00003 * 100;

  return {
    success: true,
    output: {
      triaged,
      converted,
      delegated,
      dry_run: dryRun,
      remaining: Math.max(0, (await queryOne<{ count: number }>(
        `SELECT COUNT(*) as count FROM captures WHERE user_id = ? AND processed = FALSE`,
        [context.userId]
      ))?.count || 0),
      summary: `Triaged ${triaged} capture(s): ${converted} converted, ${delegated} delegated${dryRun ? " (dry run)" : ""}`,
      results,
    },
    tokensUsed: totalTokens,
    costCents,
  };
};

// ─── compile_monthly_journal ────────────────────────

const compileMonthlyJournalDef: SkillDefinition = {
  skillId: "compile_monthly_journal",
  name: "Compile Monthly Journal",
  description:
    "Compile all daily journal entries from a given month into a single monthly journal note with AI-generated summary, category breakdown, and highlights.",
  category: "content",
  version: "1.0.0",
  inputSchema: {
    year: {
      type: "number",
      description: "Year to compile (defaults to current year)",
    },
    month: {
      type: "number",
      description: "Month to compile, 1-12 (defaults to current month)",
    },
    use_ai: {
      type: "boolean",
      description: "Whether to include AI-generated summary and highlights",
      default: true,
    },
  },
  costTier: "medium",
  requiresAuth: true,
  rateLimitPerHour: 5,
  tags: ["journal", "monthly", "compilation", "summary", "content"],
};

const compileMonthlyJournalHandler: SkillHandler = async (params, context) => {
  const year = (params.year as number) || new Date().getFullYear();
  const month = (params.month as number) || (new Date().getMonth() + 1);
  const useAI = params.use_ai !== false;

  const monthStr = `${year}-${String(month).padStart(2, "0")}`;
  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const monthName = monthNames[month - 1];

  // Get all journal entries for this month
  const entries = await queryAll<{
    id: string;
    date: string;
    entry_text: string;
    category: string;
    tags: string;
    mood: string | null;
  }>(
    `SELECT id, date, entry_text, category, tags, mood
     FROM journal_entries
     WHERE user_id = ? AND date LIKE ? || '%'
     ORDER BY date ASC, created_at ASC`,
    [context.userId, monthStr]
  );

  if (entries.length === 0) {
    return {
      success: true,
      output: {
        compiled: false,
        message: `No journal entries found for ${monthName} ${year}`,
      },
    };
  }

  // Group by date
  const byDate: Record<string, typeof entries> = {};
  const categoryStats: Record<string, number> = {};
  for (const entry of entries) {
    if (!byDate[entry.date]) byDate[entry.date] = [];
    byDate[entry.date].push(entry);
    categoryStats[entry.category] = (categoryStats[entry.category] || 0) + 1;
  }

  // Build compiled content
  let compiledContent = `# ${monthName} ${year} Journal\n\n`;
  compiledContent += `*${entries.length} entries across ${Object.keys(byDate).length} days*\n\n---\n\n`;

  for (const [date, dayEntries] of Object.entries(byDate)) {
    const dayDate = new Date(date + "T12:00:00");
    const dayName = dayDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
    compiledContent += `## ${dayName}\n\n`;
    for (const entry of dayEntries) {
      const badge = entry.category !== "general" ? ` \`${entry.category}\`` : "";
      compiledContent += `- ${entry.entry_text}${badge}\n`;
    }
    compiledContent += "\n";
  }

  // AI summary
  let summary: string | null = null;
  let highlights: string[] = [];
  let tokensUsed = 0;

  if (useAI) {
    try {
      const entrySummaries = entries
        .map(e => `[${e.date}] (${e.category}) ${e.entry_text}`)
        .join("\n");

      const prompt = `Analyze this month's journal entries and provide:
1. A 3-4 sentence summary of the month's themes and highlights
2. 3-5 key highlights or milestones

Journal entries for ${monthName} ${year}:
${entrySummaries.substring(0, 6000)}

Respond in JSON: { "summary": "...", "highlights": ["...", "..."] }`;

      const response = await complete(prompt, {
        slot: "fast",
        userId: context.userId,
        maxTokens: 500,
        temperature: 0.5,
      });

      const cleaned = response.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const parsed = JSON.parse(cleaned);
      summary = parsed.summary || null;
      highlights = parsed.highlights || [];
      tokensUsed = Math.ceil((prompt.length + response.length) / 4);

      if (summary) {
        compiledContent += `---\n\n## Monthly Summary\n\n${summary}\n\n`;
      }
      if (highlights.length > 0) {
        compiledContent += `### Highlights\n\n${highlights.map(h => `- ${h}`).join("\n")}\n\n`;
      }
    } catch {
      // Continue without AI summary
    }
  }

  // Category breakdown
  compiledContent += `---\n\n### Categories\n\n`;
  for (const [cat, count] of Object.entries(categoryStats).sort((a, b) => b[1] - a[1])) {
    compiledContent += `- **${cat}**: ${count} entries\n`;
  }

  // Upsert monthly journal
  const { v4: uuidv4 } = await import("uuid");

  const existing = await queryOne<{ id: string; note_id: string }>(
    "SELECT id, note_id FROM monthly_journals WHERE user_id = ? AND year = ? AND month = ?",
    [context.userId, year, month]
  );

  let noteId: string;

  if (existing) {
    noteId = existing.note_id;
    await db.execute({
      sql: `UPDATE notes SET content = ?, content_plain = ?, updated_at = datetime('now') WHERE id = ?`,
      args: [compiledContent, compiledContent, noteId],
    });
    await db.execute({
      sql: `UPDATE monthly_journals SET entry_count = ?, summary = ?, categories = ?, highlights = ?, compiled_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
      args: [entries.length, summary, JSON.stringify(categoryStats), JSON.stringify(highlights), existing.id],
    });
  } else {
    noteId = uuidv4();
    const slug = `monthly-journal-${year}-${String(month).padStart(2, "0")}`;

    await db.execute({
      sql: `INSERT INTO notes (id, user_id, title, slug, content, content_plain, note_type, metadata)
            VALUES (?, ?, ?, ?, ?, ?, 'monthly_journal', ?)`,
      args: [noteId, context.userId, `${monthName} ${year} Journal`, slug, compiledContent, compiledContent, JSON.stringify({ year, month })],
    });

    const mjId = uuidv4();
    await db.execute({
      sql: `INSERT INTO monthly_journals (id, note_id, user_id, year, month, entry_count, summary, categories, highlights, compiled_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      args: [mjId, noteId, context.userId, year, month, entries.length, summary, JSON.stringify(categoryStats), JSON.stringify(highlights)],
    });
  }

  return {
    success: true,
    output: {
      compiled: true,
      note_id: noteId,
      month: monthName,
      year,
      entry_count: entries.length,
      days_with_entries: Object.keys(byDate).length,
      categories: categoryStats,
      summary,
      highlights,
    },
    tokensUsed,
    costCents: tokensUsed * 0.00003 * 100,
  };
};

// ─── Registration ────────────────────────────────────

/**
 * Register all built-in skills. Call this once during app initialization.
 */
export function registerBuiltinSkills(): void {
  registerSkill(sendNotificationDef, sendNotificationHandler);
  registerSkill(delegateToAgentDef, delegateToAgentHandler);
  registerSkill(summarizeContentDef, summarizeContentHandler);
  registerSkill(findRelatedNotesDef, findRelatedNotesHandler);
  registerSkill(enqueueProcessingDef, enqueueProcessingHandler);
  registerSkill(generateInsightsDef, generateInsightsHandler);
  registerSkill(dailyDigestDef, dailyDigestHandler);
  registerSkill(autoTriageCapturesDef, autoTriageCapturesHandler);
  registerSkill(compileMonthlyJournalDef, compileMonthlyJournalHandler);
  registerSkill(manageTableDef, manageTableHandler);

  console.log(`[SkillRegistry] Registered ${10} built-in skills`);
}
