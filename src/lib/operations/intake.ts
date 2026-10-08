/**
 * Intake: captured → proposed → confirmed → completed.
 *
 * - **Captured**: an unprocessed `captures` row. Landing there is already safe;
 *   nothing here changes how captures are written.
 * - **Proposed**: computed on read by `proposeTriage`. Not stored, so a
 *   proposal can never be mistaken for a decision the user made.
 * - **Confirmed**: the user accepted (and possibly edited) the proposal. Only
 *   now is a record written — a task carrying `metadata.ops.source` pointing
 *   back at the capture — and the capture is marked processed, with a note in
 *   its own metadata saying what it became.
 * - **Completed**: the task's own status.
 *
 * Reference and context are "filed": the capture is marked processed and
 * nothing else is created. Every action here has an exact undo.
 */

import { db, query, queryOne } from "@/lib/db/client";
import { createOpsItem, getToday, getOpsItem, OpsError } from "./queries";
import { proposeTriage, type TriageKind, type TriageProposal } from "./triage";
import type { OpsDirection, OpsItem, OpsKind } from "./types";

const INTAKE_LIMIT = 50;
const CONTACT_LIMIT = 500;

export interface IntakeItem {
  id: string;
  content: string;
  captureType: string;
  capturedAt: string;
  sourceLabel: string | null;
  proposal: TriageProposal;
}

export interface IntakeList {
  today: string;
  items: IntakeItem[];
  total: number;
  projects: { id: string; name: string; ventureName: string | null }[];
}

interface CaptureRow {
  id: string;
  content: string;
  capture_type: string | null;
  captured_at: string | null;
  metadata: string | null;
  linked_projects: string | null;
  source_label?: string | null;
  processed?: number | boolean | null;
}

async function loadProjectsForTriage(userId: string) {
  try {
    return await query<{ id: string; name: string; venture_name: string | null }>(
      `SELECT p.id, p.name, v.canonical_name AS venture_name FROM projects p
       LEFT JOIN entities v ON v.id = p.venture_id
       WHERE p.user_id = ? AND p.status NOT IN ('completed', 'archived')
       ORDER BY p.name COLLATE NOCASE`,
      [userId]
    );
  } catch {
    return query<{ id: string; name: string; venture_name: string | null }>(
      `SELECT id, name, NULL AS venture_name FROM projects
       WHERE user_id = ? AND status NOT IN ('completed', 'archived')
       ORDER BY name COLLATE NOCASE`,
      [userId]
    );
  }
}

async function loadContactsForTriage(userId: string) {
  try {
    return await query<{ id: string; name: string }>(
      `SELECT id, canonical_name AS name FROM entities
       WHERE user_id = ? AND entity_type IN ('person', 'org')
       ORDER BY mention_count DESC LIMIT ${CONTACT_LIMIT}`,
      [userId]
    );
  } catch {
    return [];
  }
}

export async function listIntake(userId: string, now: Date = new Date()): Promise<IntakeList> {
  const [{ today }, captures, totalRow, projects, contacts] = await Promise.all([
    getToday(userId, now),
    query<CaptureRow>(
      `SELECT id, content, capture_type, captured_at, metadata, linked_projects, source_label
       FROM captures
       WHERE user_id = ? AND (processed = 0 OR processed IS NULL)
       ORDER BY captured_at DESC LIMIT ${INTAKE_LIMIT}`,
      [userId]
    ),
    queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM captures WHERE user_id = ? AND (processed = 0 OR processed IS NULL)`,
      [userId]
    ),
    loadProjectsForTriage(userId),
    loadContactsForTriage(userId),
  ]);

  const triageProjects = projects.map((p) => ({
    id: String(p.id),
    name: p.name,
    ventureName: p.venture_name,
  }));
  const triageContacts = contacts.map((c) => ({ id: String(c.id), name: c.name }));

  return {
    today,
    total: Number(totalRow?.n) || 0,
    projects: triageProjects,
    items: captures.map((row) => ({
      id: String(row.id),
      content: row.content,
      captureType: row.capture_type ?? "thought",
      capturedAt: row.captured_at ?? "",
      sourceLabel: row.source_label ?? null,
      proposal: proposeTriage(
        { content: row.content, captureType: row.capture_type, capturedAt: row.captured_at },
        { today, projects: triageProjects, contacts: triageContacts }
      ),
    })),
  };
}

// ─── Acting on a capture ────────────────────────────────────────────────

export interface ConfirmInput {
  kind: TriageKind;
  title?: string;
  dueDate?: string | null;
  projectId?: string | null;
  counterparty?: string | null;
  counterpartyEntityId?: string | null;
  direction?: OpsDirection | null;
  options?: string[];
}

export type IntakeAction =
  | { action: "confirm"; input: ConfirmInput }
  | { action: "file"; projectId?: string | null; kind?: "reference" | "context" }
  | { action: "dismiss" }
  | { action: "reopen" };

export type IntakeResult =
  | { outcome: "confirmed"; captureId: string; item: OpsItem }
  | { outcome: "filed" | "dismissed" | "reopened"; captureId: string; cancelledTaskId?: string };

function parse(raw: string | null): Record<string, unknown> {
  try {
    const value = JSON.parse(raw || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

const OPS_KIND_SET = new Set<string>(["action", "decision", "waiting", "commitment"]);

async function loadCapture(userId: string, captureId: string): Promise<CaptureRow> {
  const row = await queryOne<CaptureRow>(
    `SELECT id, content, capture_type, captured_at, metadata, linked_projects, processed
     FROM captures WHERE id = ? AND user_id = ?`,
    [captureId, userId]
  );
  if (!row) throw new OpsError("Capture not found", 404);
  return row;
}

async function markCapture(
  userId: string,
  captureId: string,
  metadata: Record<string, unknown>,
  processed: boolean,
  linkedProjects?: string
) {
  await db.execute({
    sql: `UPDATE captures SET processed = ?, metadata = ?${linkedProjects !== undefined ? ", linked_projects = ?" : ""}
          WHERE id = ? AND user_id = ?`,
    args:
      linkedProjects !== undefined
        ? [processed ? 1 : 0, JSON.stringify(metadata), linkedProjects, captureId, userId]
        : [processed ? 1 : 0, JSON.stringify(metadata), captureId, userId],
  });
}

export async function actOnCapture(
  userId: string,
  captureId: string,
  request: IntakeAction
): Promise<IntakeResult> {
  const capture = await loadCapture(userId, captureId);
  const metadata = parse(capture.metadata);
  const stamp = new Date().toISOString();

  if (request.action === "reopen") {
    // Undo: put the capture back in intake. A task created by confirming it is
    // cancelled rather than deleted — the record of having confirmed it stays.
    const triage = parse(JSON.stringify(metadata.triage ?? {}));
    let cancelledTaskId: string | undefined;
    if (triage.state === "confirmed" && typeof triage.task_id === "string") {
      const task = await getOpsItem(userId, triage.task_id);
      if (task && task.status !== "completed") {
        await db.execute({
          sql: `UPDATE tasks SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND user_id = ?`,
          args: [triage.task_id, userId],
        });
        cancelledTaskId = triage.task_id;
      }
    }
    delete metadata.triage;
    await markCapture(userId, captureId, metadata, false);
    return { outcome: "reopened", captureId, cancelledTaskId };
  }

  if (request.action === "dismiss") {
    metadata.triage = { state: "dismissed", at: stamp };
    await markCapture(userId, captureId, metadata, true);
    return { outcome: "dismissed", captureId };
  }

  if (request.action === "file") {
    let linked: string | undefined;
    if (request.projectId) {
      const project = await queryOne<{ id: string }>(
        "SELECT id FROM projects WHERE id = ? AND user_id = ?",
        [request.projectId, userId]
      );
      if (!project) throw new OpsError("Project not found", 404);
      let current: unknown[] = [];
      try {
        const parsed = JSON.parse(capture.linked_projects || "[]");
        current = Array.isArray(parsed) ? parsed : [];
      } catch {
        current = [];
      }
      if (!current.includes(request.projectId)) {
        linked = JSON.stringify([...current, request.projectId]);
      }
    }
    metadata.triage = {
      state: "filed",
      kind: request.kind ?? "reference",
      project_id: request.projectId ?? null,
      at: stamp,
    };
    await markCapture(userId, captureId, metadata, true, linked);
    return { outcome: "filed", captureId };
  }

  // confirm
  const input = request.input;
  if (!OPS_KIND_SET.has(input.kind)) {
    // Reference and context have nothing to commit to — they are filed.
    return actOnCapture(userId, captureId, {
      action: "file",
      projectId: input.projectId,
      kind: input.kind === "context" ? "context" : "reference",
    });
  }

  const title = (input.title ?? "").trim() || capture.content.split("\n")[0].slice(0, 120);
  const item = await createOpsItem(userId, {
    title,
    description: capture.content.trim() === title ? undefined : capture.content,
    projectId: input.projectId ?? null,
    dueDate: input.dueDate ?? null,
    ops: {
      kind: input.kind as OpsKind,
      state: "confirmed",
      counterparty: input.counterparty ?? undefined,
      counterparty_entity_id: input.counterpartyEntityId ?? undefined,
      direction: input.kind === "commitment" ? input.direction ?? "i_owe" : undefined,
      options: input.kind === "decision" && input.options?.length ? input.options : undefined,
      source: { type: "capture", id: captureId },
    },
  });

  metadata.triage = { state: "confirmed", kind: input.kind, task_id: item.id, at: stamp };
  await markCapture(userId, captureId, metadata, true);
  return { outcome: "confirmed", captureId, item };
}
