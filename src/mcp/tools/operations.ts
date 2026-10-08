/**
 * MCP Tools: Operations Control Center
 *
 * The same reads and writes the `/operations` screens use, so an assistant
 * and the UI always describe the same records. Everything here operates on
 * existing tasks, projects, contacts and captures — see
 * `src/lib/operations/types.ts`.
 *
 * Writes are scoped to one record per call and every write returns the
 * previous state, so a mistaken "move this to waiting on Will" can be put back
 * exactly. Nothing here sends a message or touches an external system.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult, type ToolContext } from "../guard";
import { validateOpsPatch } from "@/lib/operations/fields";
import {
  buildHomeSections,
  countItems,
  dayOf,
  filterView,
  isOpen,
  isOverdue,
} from "@/lib/operations/classify";
import {
  createOpsItem,
  getToday,
  loadOpenItems,
  OpsError,
  updateOpsItem,
} from "@/lib/operations/queries";
import { getPortfolio } from "@/lib/operations/portfolio";
import { getRelationships } from "@/lib/operations/people";
import { actOnCapture, listIntake } from "@/lib/operations/intake";
import { alertsOnly, getAutomationHealth } from "@/lib/operations/automations";
import { addDaysToDate } from "@/lib/email/when";
import type { OpsItem } from "@/lib/operations/types";
import {
  createOperationalItemShape,
  getAutomationHealthShape,
  getPortfolioShape,
  listIntakeShape,
  listOperationalItemsShape,
  listRelationshipsShape,
  operationsOverviewShape,
  setOperationalStateShape,
  triageCaptureShape,
} from "@/lib/operations/tool-schemas";

function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function failure(error: unknown) {
  const message = error instanceof OpsError ? error.message : "The operation failed.";
  if (!(error instanceof OpsError)) console.error("[mcp/operations]", error);
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

/** A compact item for a model to read: no nesting it has to unpick. */
function slim(item: OpsItem) {
  return {
    id: item.id,
    title: item.title,
    kind: item.ops.kind,
    state: item.ops.state,
    owner: item.ops.owner,
    counterparty: item.ops.counterparty ?? null,
    counterparty_contact_id: item.ops.counterparty_entity_id ?? null,
    direction: item.ops.direction ?? null,
    expected_at: item.ops.expected_at ?? null,
    blocked_by: item.ops.blocked_by ?? null,
    why: item.ops.why ?? null,
    options: item.ops.options ?? null,
    status: item.status,
    priority: item.priority,
    due_date: item.dueDate,
    project: item.projectName,
    project_id: item.projectId,
    venture: item.ventureName,
    link: item.href,
  };
}

/** Pull just the `ops` keys out of a tool call's params. */
function opsInput(params: Record<string, unknown>) {
  const keys = [
    "kind",
    "owner",
    "counterparty",
    "counterparty_entity_id",
    "expected_at",
    "blocked_by",
    "direction",
    "why",
    "options",
    "consequence",
  ];
  return Object.fromEntries(keys.filter((k) => k in params && params[k] !== undefined).map((k) => [k, params[k]]));
}

export function registerOperationsTools(server: McpServer, ctx: ToolContext) {
  server.tool(
    "operations_overview",
    "What needs the user now: overdue and due-today work, blocked items, open decisions, what they are waiting on, promises, this week's deadlines, untriaged captures and failing automations. Bounded; call list_operational_items for full lists.",
    operationsOverviewShape,
    async () => {
      const guard = ctx.guard("tasks:read");
      if (!guard.ok) return errorResult(guard);
      try {
        const [{ today }, items, intake, automations] = await Promise.all([
          getToday(guard.userId),
          loadOpenItems(guard.userId),
          listIntake(guard.userId),
          getAutomationHealth(guard.userId),
        ]);
        return json({
          today,
          counts: countItems(items, today),
          sections: buildHomeSections(items, today).map((s) => ({
            section: s.title,
            total: s.total,
            items: s.items.map(slim),
          })),
          captures_to_triage: intake.total,
          automation_alerts: alertsOnly(automations).map((a) => ({
            name: a.name,
            status: a.status,
            signal: a.signal,
          })),
        });
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.tool(
    "list_operational_items",
    "List open operational items (tasks) by view: decisions, waiting, commitments, blocked, blocked_by_me, today, week or all. Filter by counterparty, project, venture or date. Answers \"what am I waiting on from vendors?\", \"what promises do I have out this month?\".",
    listOperationalItemsShape,
    async (params) => {
      const guard = ctx.guard("tasks:read");
      if (!guard.ok) return errorResult(guard);
      try {
        const [{ today }, all] = await Promise.all([getToday(guard.userId), loadOpenItems(guard.userId)]);
        let items: OpsItem[];
        switch (params.view) {
          case "decisions":
          case "waiting":
          case "commitments":
          case "blocked":
            items = filterView(all, params.view);
            break;
          case "blocked_by_me":
            items = all.filter(
              (i) => i.ops.blocked_by === "me" || (i.ops.kind === "decision" && i.ops.state === "confirmed")
            );
            break;
          case "today":
            items = all.filter(
              (i) => i.ops.owner === "me" && (isOverdue(i, today) || dayOf(i.dueDate) === today)
            );
            break;
          case "week": {
            const end = addDaysToDate(today, 7);
            items = all.filter((i) => i.nextDate && i.nextDate <= end);
            break;
          }
          default:
            items = all.filter(isOpen);
        }
        if (params.counterparty) {
          const needle = params.counterparty.toLowerCase();
          items = items.filter((i) => (i.ops.counterparty ?? "").toLowerCase().includes(needle));
        }
        if (params.project_id) items = items.filter((i) => i.projectId === params.project_id);
        if (params.venture_id) items = items.filter((i) => i.ventureId === params.venture_id);
        if (params.due_before) {
          const limit = params.due_before;
          items = items.filter((i) => i.nextDate && i.nextDate <= limit);
        }
        items.sort((a, b) => (a.nextDate ?? "9999").localeCompare(b.nextDate ?? "9999"));
        return json({ today, count: items.length, items: items.slice(0, params.limit).map(slim) });
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.tool(
    "set_operational_state",
    "Change what one task is and who holds it: mark it a decision, waiting on someone (with an expected date), a promise, blocked/unblocked, move it to a project, reschedule, complete or close it. Pass null to clear a field. Returns the previous state so the change can be undone.",
    setOperationalStateShape,
    async (params) => {
      const guard = ctx.guard("tasks:write");
      if (!guard.ok) return errorResult(guard);
      const patch = validateOpsPatch(opsInput(params));
      if (!patch.ok) return failure(new OpsError(patch.error));
      try {
        const result = await updateOpsItem(guard.userId, params.task_id, {
          // An assistant relabelling an item is acting for the user, so the
          // item is confirmed; a status-only change leaves `ops` untouched.
          ops: Object.keys(patch.patch).length ? { ...patch.patch, state: "confirmed" } : undefined,
          status: params.status,
          dueDate: params.due_date,
          projectId: params.project_id,
        });
        return json({
          item: slim(result.item),
          previous: {
            ops: result.previous,
            status: result.previousStatus,
            due_date: result.previousDueDate,
          },
        });
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.tool(
    "create_operational_item",
    "Create a task that is a decision, something waited on, a promise, or a plain action. It is an ordinary task and shows everywhere tasks do.",
    createOperationalItemShape,
    async (params) => {
      const guard = ctx.guard("tasks:write");
      if (!guard.ok) return errorResult(guard);
      const patch = validateOpsPatch(opsInput(params));
      if (!patch.ok) return failure(new OpsError(patch.error));
      try {
        const item = await createOpsItem(
          guard.userId,
          {
            title: params.title,
            description: params.description,
            projectId: params.project_id ?? null,
            dueDate: params.due_date ?? null,
            priority: params.priority,
            ops: { ...patch.patch, state: "confirmed" },
          },
          ctx.provenance()
        );
        return json({ item: slim(item) });
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.tool(
    "get_portfolio",
    "Projects grouped by venture, each with its lane state (active/waiting/blocked/future/reference, chosen or read from status), health, next move, who owns it, and next date. Flags projects that look dormant without changing them.",
    getPortfolioShape,
    async (params) => {
      const guard = ctx.guard("projects:read");
      if (!guard.ok) return errorResult(guard);
      try {
        const portfolio = await getPortfolio(guard.userId);
        const filter = params.lane_state;
        return json({
          today: portfolio.today,
          counts: portfolio.counts,
          lanes: portfolio.lanes
            .map((lane) => ({
              lane: lane.name,
              venture_id: lane.isVenture ? lane.id : null,
              projects: lane.projects
                .filter((p) => !filter || (filter === "dormant" ? p.looksDormant : p.laneState === filter))
                .map((p) => ({
                  id: p.id,
                  name: p.name,
                  lane_state: p.laneState,
                  lane_state_chosen: p.laneStateChosen,
                  looks_dormant: p.looksDormant,
                  health: p.health,
                  health_reason: p.healthReason,
                  next_move: p.nextMove,
                  next_date: p.nextDate,
                  open_items: p.openCount,
                  link: p.href,
                })),
            }))
            .filter((lane) => lane.projects.length > 0),
        });
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.tool(
    "list_relationships",
    "People and orgs the user is in the middle of something with: what the user owes them, what they owe the user, relationship stage, ventures, and last real touch.",
    listRelationshipsShape,
    async (params) => {
      const guard = ctx.guard("crm:read");
      if (!guard.ok) return errorResult(guard);
      try {
        const view = await getRelationships(guard.userId, { ventureId: params.venture_id });
        const needle = params.name?.toLowerCase();
        const rows = needle ? view.rows.filter((r) => r.name.toLowerCase().includes(needle)) : view.rows;
        return json({
          today: view.today,
          people: rows.map((r) => ({
            name: r.name,
            contact_id: r.entityId,
            in_contacts: !!r.entityId,
            stage: r.stage,
            ventures: r.ventures,
            last_touch: r.lastTouch,
            follow_up_due: r.followUpDue,
            you_owe: r.youOwe.map(slim),
            they_owe: r.theyOwe.map(slim),
          })),
        });
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.tool(
    "list_intake",
    "Captures not yet triaged, each with a rule-based proposal (kind, project, due date, counterparty) and the reasons for it. Proposals are suggestions; nothing is created until triage_capture confirms one.",
    listIntakeShape,
    async (params) => {
      const guard = ctx.guard("captures:read");
      if (!guard.ok) return errorResult(guard);
      try {
        const intake = await listIntake(guard.userId);
        return json({
          total: intake.total,
          captures: intake.items.slice(0, params.limit).map((i) => ({
            id: i.id,
            content: i.content,
            captured_at: i.capturedAt,
            proposal: i.proposal,
          })),
        });
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.tool(
    "triage_capture",
    "Act on one capture: confirm it as a task/decision/waiting/commitment, file it as reference/context, dismiss it, or reopen it (undo). Confirm only when the user asked for that.",
    triageCaptureShape,
    async (params) => {
      const guard = ctx.guard("tasks:write");
      if (!guard.ok) return errorResult(guard);
      try {
        if (params.action === "confirm") {
          let kind = params.kind;
          if (!kind) {
            const intake = await listIntake(guard.userId);
            kind = intake.items.find((i) => i.id === params.capture_id)?.proposal.kind;
            if (!kind) return failure(new OpsError("Pass kind: the capture is not in the current intake list"));
          }
          const result = await actOnCapture(guard.userId, params.capture_id, {
            action: "confirm",
            input: {
              kind,
              title: params.title,
              dueDate: params.due_date ?? null,
              projectId: params.project_id ?? null,
              counterparty: params.counterparty ?? null,
              direction: params.direction ?? null,
            },
          });
          return json(result.outcome === "confirmed" ? { ...result, item: slim(result.item) } : result);
        }
        if (params.action === "file") {
          return json(
            await actOnCapture(guard.userId, params.capture_id, {
              action: "file",
              projectId: params.project_id ?? null,
              kind: params.kind === "context" ? "context" : "reference",
            })
          );
        }
        return json(await actOnCapture(guard.userId, params.capture_id, { action: params.action }));
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.tool(
    "get_automation_health",
    "Background jobs and heartbeat rules: what each is for, healthy/degraded/failing/paused/unknown/not connected, last success, and a plain-language failure signal.",
    getAutomationHealthShape,
    async (params) => {
      const guard = ctx.guard("tasks:read");
      if (!guard.ok) return errorResult(guard);
      try {
        const all = await getAutomationHealth(guard.userId);
        return json({ automations: params.only_problems ? alertsOnly(all) : all });
      } catch (error) {
        return failure(error);
      }
    }
  );
}
