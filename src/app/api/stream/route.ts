/**
 * Stream API - Unified feed endpoint
 *
 * GET: Fetch stream items (unified view of notes, tasks, captures, agent outputs)
 * POST: Create a new stream item (with AI classification)
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { query, queryOne, mutate } from "@/lib/db/client";
import { db } from "@/lib/db/client";
import { v4 as uuid } from "uuid";
import { classifyIntent } from "@/lib/stream/classifier";
import { normalizeActor } from "@/lib/provenance";
import { format } from "date-fns";

// GET /api/stream - Fetch unified stream
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const limit = parseInt(searchParams.get("limit") || "30");
  const offset = parseInt(searchParams.get("offset") || "0");
  const types = searchParams.get("types")?.split(",").filter(Boolean) || [];
  const statuses = searchParams.get("statuses")?.split(",").filter(Boolean) || [];
  const search = searchParams.get("q") || "";
  const projectId = searchParams.get("projectId") || "";

  try {
    // Build unified query from multiple tables
    // This pulls from captures, tasks, notes, agent_tasks, and insights
    // into a single timeline view

    const clampedLimit = Math.min(Math.max(1, limit), 100);
    const clampedOffset = Math.max(0, offset);

    const whereConditions = ["1=1"];
    const params: (string | number)[] = [];

    if (types.length > 0) {
      whereConditions.push(`item_type IN (${types.map(() => "?").join(",")})`);
      params.push(...types);
    }

    if (statuses.length > 0) {
      whereConditions.push(`item_status IN (${statuses.map(() => "?").join(",")})`);
      params.push(...statuses);
    }

    if (search) {
      whereConditions.push(`(item_title LIKE ? OR item_content LIKE ?)`);
      params.push(`%${search}%`, `%${search}%`);
    }

    if (projectId) {
      whereConditions.push(`project_id = ?`);
      params.push(projectId);
    }

    const whereClause = whereConditions.join(" AND ");

    // Unified stream query - merges all entity types into a single feed
    // user.id is passed as parameterized ? for each UNION subquery (6 total)
    const userIdParams = [user.id, user.id, user.id, user.id, user.id, user.id];

    const itemsSql = `
      SELECT * FROM (
        -- Captures as stream items
        SELECT
          c.id,
          CASE c.capture_type
            WHEN 'thought' THEN 'thought'
            WHEN 'idea' THEN 'thought'
            WHEN 'task' THEN 'task'
            WHEN 'followup' THEN 'task'
            WHEN 'link' THEN 'reference'
            WHEN 'quote' THEN 'reference'
            WHEN 'reference' THEN 'reference'
            ELSE 'capture'
          END as item_type,
          CASE WHEN c.processed THEN 'archived' ELSE 'active' END as item_status,
          SUBSTR(c.content, 1, 60) as item_title,
          c.content as item_content,
          'medium' as priority,
          NULL as project_id,
          NULL as project_name,
          NULL as project_color,
          c.tags,
          NULL as due_date,
          at_cap.assigned_agent as delegated_to,
          at_cap.id as agent_task_id,
          at_cap.status as agent_status,
          'manual' as source_type,
          COALESCE(c.source_actor, 'human') as source_actor,
          c.source_key_id,
          c.source_label,
          c.source_run_id,
          c.created_at,
          c.created_at as updated_at,
          NULL as completed_at
        FROM captures c
        LEFT JOIN agent_tasks at_cap ON at_cap.source_type IN ('capture', 'thought') AND at_cap.source_id = c.id AND at_cap.status NOT IN ('approved', 'rejected', 'failed')
        WHERE c.user_id = ?

        UNION ALL

        -- Tasks as stream items
        SELECT
          t.id,
          'task' as item_type,
          CASE t.status
            WHEN 'pending' THEN 'active'
            WHEN 'in_progress' THEN 'processing'
            WHEN 'completed' THEN 'completed'
            WHEN 'cancelled' THEN 'archived'
          END as item_status,
          COALESCE(t.title, t.content) as item_title,
          COALESCE(t.description, t.content) as item_content,
          t.priority,
          t.project_id,
          p.name as project_name,
          p.color as project_color,
          t.tags,
          t.due_date,
          t.delegated_to,
          t.agent_task_id,
          at_sub.status as agent_status,
          CASE WHEN t.delegated_to IS NOT NULL THEN 'ai_generated' ELSE 'manual' END as source_type,
          COALESCE(t.source_actor, 'human') as source_actor,
          t.source_key_id,
          t.source_label,
          t.source_run_id,
          t.created_at,
          t.updated_at,
          t.completed_at
        FROM tasks t
        LEFT JOIN projects p ON t.project_id = p.id
        LEFT JOIN agent_tasks at_sub ON t.agent_task_id = at_sub.id
        WHERE t.user_id = ?

        UNION ALL

        -- Recent notes as stream items
        SELECT
          n.id,
          CASE n.note_type
            WHEN 'daily' THEN 'note'
            WHEN 'journal' THEN 'journal'
            WHEN 'monthly_journal' THEN 'journal'
            WHEN 'insight' THEN 'insight'
            ELSE 'note'
          END as item_type,
          CASE WHEN n.is_archived THEN 'archived' ELSE 'active' END as item_status,
          n.title as item_title,
          COALESCE(n.content_plain, SUBSTR(n.content, 1, 300)) as item_content,
          'low' as priority,
          n.project_id,
          p.name as project_name,
          p.color as project_color,
          COALESCE(n.auto_tags, '[]') as tags,
          NULL as due_date,
          at_note.assigned_agent as delegated_to,
          at_note.id as agent_task_id,
          at_note.status as agent_status,
          'manual' as source_type,
          COALESCE(n.source_actor, 'human') as source_actor,
          n.source_key_id,
          n.source_label,
          n.source_run_id,
          n.created_at,
          n.updated_at,
          NULL as completed_at
        FROM notes n
        LEFT JOIN projects p ON n.project_id = p.id
        LEFT JOIN agent_tasks at_note ON at_note.source_type = 'note' AND at_note.source_id = n.id AND at_note.status NOT IN ('approved', 'rejected', 'failed')
        WHERE n.user_id = ?

        UNION ALL

        -- Reminders as stream items
        SELECT
          r.id,
          'reminder' as item_type,
          CASE r.status
            WHEN 'pending' THEN 'active'
            WHEN 'triggered' THEN 'waiting'
            WHEN 'snoozed' THEN 'active'
            WHEN 'dismissed' THEN 'archived'
          END as item_status,
          r.title as item_title,
          COALESCE(r.content, r.title) as item_content,
          r.priority,
          r.project_id,
          p.name as project_name,
          p.color as project_color,
          r.tags,
          r.remind_at as due_date,
          at_rem.assigned_agent as delegated_to,
          at_rem.id as agent_task_id,
          at_rem.status as agent_status,
          'manual' as source_type,
          COALESCE(r.source_actor, 'human') as source_actor,
          r.source_key_id,
          r.source_label,
          r.source_run_id,
          r.created_at,
          r.updated_at,
          r.dismissed_at as completed_at
        FROM reminders r
        LEFT JOIN projects p ON r.project_id = p.id
        LEFT JOIN agent_tasks at_rem ON at_rem.source_type = 'reminder' AND at_rem.source_id = r.id AND at_rem.status NOT IN ('approved', 'rejected', 'failed')
        WHERE r.user_id = ?

        UNION ALL

        -- AI Insights as stream items
        SELECT
          i.id,
          'insight' as item_type,
          CASE
            WHEN i.is_dismissed THEN 'archived'
            WHEN i.is_actioned THEN 'completed'
            ELSE 'active'
          END as item_status,
          i.title as item_title,
          i.content as item_content,
          'low' as priority,
          NULL as project_id,
          NULL as project_name,
          NULL as project_color,
          '[]' as tags,
          NULL as due_date,
          NULL as delegated_to,
          NULL as agent_task_id,
          NULL as agent_status,
          'ai_generated' as source_type,
          'agent' as source_actor,
          NULL as source_key_id,
          'Insights' as source_label,
          NULL as source_run_id,
          i.generated_at as created_at,
          i.generated_at as updated_at,
          i.actioned_at as completed_at
        FROM insights i
        WHERE i.user_id = ?

        UNION ALL

        -- Agent task outputs as stream items
        SELECT
          at2.id,
          'agent_output' as item_type,
          CASE at2.status
            WHEN 'queued' THEN 'processing'
            WHEN 'processing' THEN 'processing'
            WHEN 'awaiting_review' THEN 'waiting'
            WHEN 'revision_requested' THEN 'processing'
            WHEN 'approved' THEN 'completed'
            WHEN 'rejected' THEN 'archived'
            WHEN 'failed' THEN 'archived'
          END as item_status,
          at2.title as item_title,
          at2.description as item_content,
          at2.priority,
          at2.project_id,
          p.name as project_name,
          p.color as project_color,
          '[]' as tags,
          NULL as due_date,
          at2.assigned_agent as delegated_to,
          at2.id as agent_task_id,
          at2.status as agent_status,
          'agent_output' as source_type,
          'agent' as source_actor,
          NULL as source_key_id,
          at2.assigned_agent as source_label,
          NULL as source_run_id,
          at2.created_at,
          at2.updated_at,
          NULL as completed_at
        FROM agent_tasks at2
        LEFT JOIN projects p ON at2.project_id = p.id
        WHERE at2.user_id = ?
      )
      WHERE ${whereClause}
      ORDER BY updated_at DESC
      LIMIT ? OFFSET ?
    `;

    const countsSql = `
      SELECT item_type, COUNT(*) as count FROM (
        SELECT CASE capture_type
          WHEN 'thought' THEN 'thought'
          WHEN 'idea' THEN 'thought'
          WHEN 'task' THEN 'task'
          WHEN 'link' THEN 'reference'
          ELSE 'capture'
        END as item_type
        FROM captures WHERE user_id = ? AND processed = FALSE
        UNION ALL
        SELECT 'task' FROM tasks WHERE user_id = ? AND status IN ('pending', 'in_progress')
        UNION ALL
        SELECT 'reminder' FROM reminders WHERE user_id = ? AND status IN ('pending', 'snoozed')
        UNION ALL
        SELECT CASE WHEN note_type IN ('journal', 'monthly_journal') THEN 'journal' ELSE 'note' END FROM notes WHERE user_id = ? AND is_archived = FALSE
        UNION ALL
        SELECT 'insight' FROM insights WHERE user_id = ? AND is_dismissed = FALSE AND is_actioned = FALSE
        UNION ALL
        SELECT 'agent_output' FROM agent_tasks WHERE user_id = ? AND status IN ('awaiting_review', 'processing')
      )
      GROUP BY item_type
    `;

    // Send both queries in a single round-trip via batch
    const [itemsResult, countsResult] = await db.batch([
      { sql: itemsSql, args: [...userIdParams, ...params, clampedLimit, clampedOffset] },
      { sql: countsSql, args: [user.id, user.id, user.id, user.id, user.id, user.id] },
    ]);

    type StreamRow = {
      id: string;
      item_type: string;
      item_status: string;
      item_title: string;
      item_content: string;
      priority: string;
      project_id: string | null;
      project_name: string | null;
      project_color: string | null;
      tags: string;
      due_date: string | null;
      delegated_to: string | null;
      agent_task_id: string | null;
      agent_status: string | null;
      source_type: string;
      source_actor: string | null;
      source_key_id: string | null;
      source_label: string | null;
      source_run_id: string | null;
      created_at: string;
      updated_at: string;
      completed_at: string | null;
    };

    const items = itemsResult.rows.map(row => ({ ...row }) as unknown as StreamRow);

    const typeCounts = countsResult.rows.map(row => ({ ...row }) as unknown as {
      item_type: string;
      count: number;
    });

    return NextResponse.json({
      items: items.map((item) => ({
        id: item.id,
        type: item.item_type,
        status: item.item_status,
        title: item.item_title,
        content: item.item_content,
        priority: item.priority,
        projectId: item.project_id,
        projectName: item.project_name,
        projectColor: item.project_color,
        tags: typeof item.tags === "string" ? JSON.parse(item.tags || "[]") : [],
        dueDate: item.due_date,
        delegatedTo: item.delegated_to,
        agentTaskId: item.agent_task_id,
        agentStatus: item.agent_status,
        sourceType: item.source_type,
        // Who wrote it, and which single operation produced it. The feed
        // collapses rows sharing a run id into one entry — see
        // src/lib/stream/runs.ts.
        sourceActor: normalizeActor(item.source_actor),
        sourceKeyId: item.source_key_id,
        sourceLabel: item.source_label,
        sourceRunId: item.source_run_id,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
        completedAt: item.completed_at,
      })),
      counts: Object.fromEntries(typeCounts.map((tc) => [tc.item_type, tc.count])),
      hasMore: items.length === clampedLimit,
    });
  } catch (error) {
    console.error("[Stream API] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch stream", items: [], counts: {}, hasMore: false },
      { status: 500 }
    );
  }
}

// POST /api/stream - Create a new stream item
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    // Split by whether the classifier below may overwrite the value. The
    // `let` group is what auto-classification can fill in; the `const` group
    // is read exactly once, straight from the caller.
    let {
      type,
      title,
      content,
      classification,
      priority = "medium",
      tags = [],
      dueDate,
    } = body;
    const {
      rawInput,
      projectId,
      linkedNoteIds = [],
      sourceType = "manual",
    } = body;
    // Only an explicit value from the caller delegates now, so this never
    // changes after it is read.
    const { delegatedTo } = body;

    // Server-side auto-classification when type is missing or raw "capture"
    if (!type || type === "capture") {
      const inputText = rawInput || content || "";
      if (inputText.trim()) {
        try {
          // Get context for better classification
          const [activeProjects, recentItems] = await Promise.all([
            query<{ slug: string; name: string }>(
              "SELECT slug, name FROM projects WHERE user_id = ? AND status = 'active' LIMIT 10",
              [user.id]
            ),
            query<{ type: string; title: string }>(
              `SELECT 'task' as type, COALESCE(title, content) as title FROM tasks WHERE user_id = ? ORDER BY created_at DESC LIMIT 5
               UNION ALL
               SELECT 'note' as type, title FROM notes WHERE user_id = ? ORDER BY updated_at DESC LIMIT 5`,
              [user.id, user.id]
            ),
          ]);

          const hour = new Date().getHours();
          const timeOfDay = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";

          const autoClassification = await classifyIntent(inputText.trim(), {
            activeProjects,
            recentItems,
            timeOfDay,
          });

          // Apply classification results
          type = autoClassification.type;
          title = title || autoClassification.title;
          content = content || autoClassification.content;
          priority = autoClassification.priority || priority;
          tags = autoClassification.tags?.length ? autoClassification.tags : tags;
          dueDate = autoClassification.dueDate || dueDate;
          // The classifier still names a suggested agent, but capturing a
          // thought no longer fires one behind the user's back: work that
          // nobody asked for accumulated in a review queue nobody visited.
          // An explicit `delegatedTo` from the caller is still honoured.
          classification = autoClassification;

          console.log(`[Stream API] Auto-classified "${inputText.slice(0, 40)}..." as ${type} (confidence: ${autoClassification.confidence})`);
        } catch (classifyErr) {
          console.error("[Stream API] Auto-classification failed:", classifyErr);
          type = "capture";
        }
      }
    }

    const id = uuid();

    // Route to the appropriate table based on type
    switch (type) {
      case "thought":
      case "capture":
      case "reference": {
        const captureType = type === "reference" ? "link"
          : type === "thought" ? "thought"
          : "thought";

        await mutate(
          `INSERT INTO captures (id, user_id, content, capture_type, tags, metadata)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            id,
            user.id,
            content || rawInput,
            captureType,
            JSON.stringify(tags),
            JSON.stringify({ classification, sourceType }),
          ]
        );
        break;
      }

      case "task": {
        await mutate(
          `INSERT INTO tasks (id, user_id, content, title, description, priority, due_date, tags, delegated_to, linked_note_ids, metadata)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            user.id,
            content || rawInput,
            title || (content || rawInput).slice(0, 60),
            content || rawInput,
            priority,
            dueDate || null,
            JSON.stringify(tags),
            delegatedTo || null,
            JSON.stringify(linkedNoteIds),
            JSON.stringify({ classification, sourceType }),
          ]
        );

        // If delegated to an agent, create the agent task
        if (delegatedTo) {
          const agentTaskId = uuid();
          await mutate(
            `INSERT INTO agent_tasks (id, user_id, task_id, title, description, task_type, assigned_agent, priority, context_note_ids, project_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              agentTaskId,
              user.id,
              id,
              title || (content || rawInput).slice(0, 60),
              content || rawInput,
              delegatedTo,
              delegatedTo,
              priority,
              JSON.stringify(linkedNoteIds),
              projectId || null,
            ]
          );

          await mutate(
            `UPDATE tasks SET agent_task_id = ?, status = 'in_progress' WHERE id = ?`,
            [agentTaskId, id]
          );
        }
        break;
      }

      case "reminder": {
        await mutate(
          `INSERT INTO reminders (id, user_id, title, content, remind_at, priority, project_id, tags, metadata)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            user.id,
            title || (content || rawInput).slice(0, 60),
            content || rawInput,
            dueDate || new Date(Date.now() + 60 * 60 * 1000).toISOString(), // default: 1 hour from now
            priority,
            projectId || null,
            JSON.stringify(tags),
            JSON.stringify({ classification, sourceType }),
          ]
        );
        break;
      }

      case "journal": {
        // Create journal entry directly (avoid internal fetch which fails in Next.js)
        const entryText = content || rawInput;
        const journalDate = new Date().toISOString().split("T")[0];
        const dateTitle = format(new Date(journalDate + "T12:00:00"), "EEEE, MMMM d, yyyy");
        const journalSlug = `journal-${journalDate}`;
        const entryTitle = entryText
          .replace(/^(today i|i |this morning i|this afternoon i|this evening i|just )/i, "")
          .split(/[.\n]/)[0]
          ?.trim()
          .slice(0, 60) || entryText.slice(0, 60);

        // Find or create the daily journal note
        let journalNote = await queryOne<{ id: string; content: string; content_plain: string; title: string; slug: string }>(
          "SELECT id, content, content_plain, title, slug FROM notes WHERE user_id = ? AND slug = ?",
          [user.id, journalSlug]
        );

        if (!journalNote) {
          const noteId = uuid();
          const initialContent = `# Journal - ${dateTitle}\n\n---\n\n### ${format(new Date(), "h:mm a")}\n${entryText}\n`;
          await mutate(
            `INSERT INTO notes (id, user_id, title, slug, content, content_plain, note_type, metadata)
             VALUES (?, ?, ?, ?, ?, ?, 'journal', ?)`,
            [noteId, user.id, `Journal - ${dateTitle}`, journalSlug, initialContent, entryText, JSON.stringify({ journal_date: journalDate })]
          );
          journalNote = { id: noteId, content: initialContent, content_plain: entryText, title: `Journal - ${dateTitle}`, slug: journalSlug };
        } else {
          const timestamp = format(new Date(), "h:mm a");
          const appendText = `\n\n### ${timestamp}\n${entryText}\n`;
          await mutate(
            `UPDATE notes SET content = content || ?, content_plain = content_plain || ?, updated_at = datetime('now') WHERE id = ?`,
            [appendText, "\n" + entryText, journalNote.id]
          );
        }

        // Create the journal entry record
        const entryId = uuid();
        await mutate(
          `INSERT INTO journal_entries (id, note_id, user_id, date, entry_text, category, tags, mood, location, metadata)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [entryId, journalNote.id, user.id, journalDate, entryText, "general", JSON.stringify(tags), null, null, JSON.stringify({ classification, sourceType, timestamp: new Date().toISOString() })]
        );

        // Create/update daily_notes for backward compatibility
        const existingDaily = await queryOne<{ id: string }>(
          "SELECT id FROM daily_notes WHERE user_id = ? AND date = ?",
          [user.id, journalDate]
        );
        if (!existingDaily) {
          await mutate(
            `INSERT INTO daily_notes (user_id, date, note_id, metadata) VALUES (?, ?, ?, ?)`,
            [user.id, journalDate, journalNote.id, JSON.stringify({ is_journal: true })]
          );
        }

        return NextResponse.json({
          id: entryId,
          type: "journal",
          status: "active",
          title: entryTitle.charAt(0).toUpperCase() + entryTitle.slice(1),
          createdAt: new Date().toISOString(),
          journalNoteId: journalNote.id,
        });
      }

      case "note":
      case "question":
      case "decision": {
        const slug = `${title || "untitled"}`.toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 50)
          + "-" + id.slice(0, 8);

        await mutate(
          `INSERT INTO notes (id, user_id, title, slug, content, content_plain, metadata)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            user.id,
            title || (content || rawInput).slice(0, 60),
            slug,
            content || rawInput,
            content || rawInput,
            JSON.stringify({ classification, sourceType, originalType: type }),
          ]
        );
        break;
      }

      default: {
        // Default: create as capture
        await mutate(
          `INSERT INTO captures (id, user_id, content, capture_type, tags, metadata)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            id,
            user.id,
            content || rawInput,
            "thought",
            JSON.stringify(tags),
            JSON.stringify({ classification, sourceType }),
          ]
        );
      }
    }

    return NextResponse.json({
      id,
      type,
      status: delegatedTo ? "processing" : "active",
      title: title || (content || rawInput).slice(0, 60),
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[Stream API] Create error:", error);
    return NextResponse.json(
      { error: "Failed to create stream item" },
      { status: 500 }
    );
  }
}
