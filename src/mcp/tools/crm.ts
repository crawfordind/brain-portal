/**
 * MCP Tools: CRM
 *
 * Exposes the CRM layer to external agents.
 *
 * These tools deliberately call the same `src/lib/crm/*` modules the web app
 * uses, rather than issuing their own SQL. Two rules in particular must not
 * exist in two places:
 *
 *   - one venture per product, enforced by deleting the old `part_of` edge
 *     before inserting the new one;
 *   - history never moves with the product, so `interactions.venture_id` is
 *     written once and never recomputed.
 *
 * A second implementation of either would drift, and the drift would be silent
 * and destructive. The shared client in `src/mcp/db.ts` makes this possible:
 * the MCP process and the lib modules use one connection.
 *
 * Not here yet, because the underlying feature does not exist: deals and
 * pipelines (Phase 2), and compliance-checked drafting (Phase 3).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { query, queryOne } from "../db";
import { errorResult, type ToolContext } from "../guard";
import type { ContactChannel, Entity, Interaction } from "@/lib/db/schema";
import { isChannelKind, normalizeChannelValue } from "@/lib/crm/channels";
import {
  getCompartments,
  getCrmFields,
  getMergeCandidate,
  getResolution,
  isVenture,
  readEntityMetadata,
} from "@/lib/crm/metadata";
import {
  createProduct,
  createVenture,
  isContactRole,
  listContactRoles,
  removeContactRole,
  setContactRole,
  listUnassignedProducts,
  listVentureMembers,
  listVentures,
  moveToVenture,
  StructureError,
} from "@/lib/crm/structure";
import { logInteraction } from "@/lib/crm/interactions";
import { ingestSingleEntity } from "@/lib/crm/ingest";
import {
  listMergeCandidates,
  mergeEntities,
  resolveContact,
} from "@/lib/crm/merge";
import { db } from "@/lib/db/client";

function ok(payload: unknown) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(payload, null, 2) },
    ],
  };
}

/** Turn a StructureError into a readable tool result instead of a stack trace. */
function failure(e: unknown) {
  const message =
    e instanceof StructureError
      ? e.message
      : e instanceof Error
        ? e.message
        : "Unknown error";
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

export function registerCrmTools(server: McpServer, ctx: ToolContext) {
  // ─── search_contacts ───────────────────────────────────
  server.tool(
    "search_contacts",
    "Search CRM contacts (people and organisations) across all ventures. Excludes unresolved event captures unless you ask for them. Use before answering anything about someone the user works with.",
    {
      query: z.string().optional().describe("Name fragment to search for"),
      entity_type: z
        .enum(["person", "org", "place", "product", "input", "other"])
        .optional()
        .describe("Filter by entity type"),
      venture_id: z
        .string()
        .optional()
        .describe("Only contacts holding a role at this venture"),
      compartment: z
        .string()
        .optional()
        .describe("Only contacts tagged with this compartment, e.g. cannabis"),
      resolution: z
        .enum(["confirmed", "unresolved", "all"])
        .default("confirmed")
        .describe(
          "Unresolved contacts are event-capture placeholders awaiting a name"
        ),
      limit: z.number().min(1).max(100).default(25).describe("Max results"),
    },
    async (params) => {
      const guard = ctx.guard("crm:read");
      if (!guard.ok) return errorResult(guard);
      const userId = guard.userId;

      const args: (string | number)[] = [];
      let sql = `SELECT DISTINCT e.* FROM entities e`;
      if (params.venture_id) {
        sql += ` JOIN entity_edges ve ON ve.source_entity_id = e.id
                   AND ve.target_entity_id = ? AND ve.edge_type <> 'part_of'`;
        args.push(params.venture_id);
      }
      sql += ` WHERE e.user_id = ?`;
      args.push(userId);

      if (params.entity_type) {
        sql += ` AND e.entity_type = ?`;
        args.push(params.entity_type);
      }
      if (params.query) {
        sql += ` AND e.canonical_name LIKE ?`;
        args.push(`%${params.query}%`);
      }
      sql += ` ORDER BY e.mention_count DESC, e.last_seen_at DESC LIMIT ?`;
      args.push(params.limit);

      const rows = await query<Entity>(sql, args);

      // Resolution and compartment live in JSON, so they are filtered here,
      // where the documented defaults apply (absent means confirmed / public).
      const contacts = rows
        .filter((e) => !isVenture(e))
        .filter((e) => {
          if (params.resolution === "all") return true;
          return getResolution(e) === params.resolution;
        })
        .filter(
          (e) =>
            !params.compartment ||
            getCompartments(e).includes(params.compartment.toLowerCase())
        )
        .map((e) => ({
          id: e.id,
          name: e.canonical_name,
          type: e.entity_type,
          mentions: e.mention_count,
          last_seen_at: e.last_seen_at,
          resolution: getResolution(e),
          compartments: getCompartments(e),
          needs_review: getMergeCandidate(e) !== null,
        }));

      return ok({ count: contacts.length, contacts });
    }
  );

  // ─── get_contact_brief ─────────────────────────────────
  server.tool(
    "get_contact_brief",
    "Everything known about one contact: channels, venture roles, compartments, and a single timeline merging note mentions with actual touches. This is the pre-meeting call.",
    {
      contact_id: z.string().describe("Entity ID of the contact"),
      timeline_limit: z
        .number()
        .min(1)
        .max(200)
        .default(50)
        .describe("Max timeline entries"),
    },
    async (params) => {
      const guard = ctx.guard("crm:read");
      if (!guard.ok) return errorResult(guard);
      const userId = guard.userId;

      const entity = await queryOne<Entity>(
        `SELECT * FROM entities WHERE id = ? AND user_id = ?`,
        [params.contact_id, userId]
      );
      if (!entity) return failure(new Error("Contact not found"));

      const channels = await query<ContactChannel>(
        `SELECT kind, value, label, is_primary, verified FROM contact_channels
         WHERE entity_id = ? AND user_id = ? ORDER BY is_primary DESC, kind`,
        [params.contact_id, userId]
      );

      const roles = await query<{
        venture_id: string;
        venture_name: string;
        edge_type: string;
      }>(
        `SELECT ed.target_entity_id AS venture_id, v.canonical_name AS venture_name, ed.edge_type
         FROM entity_edges ed
         JOIN entities v ON v.id = ed.target_entity_id
         WHERE ed.user_id = ? AND ed.source_entity_id = ?
           AND ed.edge_type <> 'part_of' AND v.metadata LIKE '%"is_venture"%'`,
        [userId, params.contact_id]
      );

      const interactions = await query<
        Interaction & { venture_name: string | null }
      >(
        `SELECT i.*, v.canonical_name AS venture_name FROM interactions i
         LEFT JOIN entities v ON v.id = i.venture_id
         WHERE i.user_id = ? AND i.entity_id = ?
         ORDER BY i.occurred_at DESC LIMIT ?`,
        [userId, params.contact_id, params.timeline_limit]
      );

      const mentions = await query<{
        source_type: string;
        source_id: string;
        snippet: string | null;
        occurred_at: string | null;
        created_at: string;
      }>(
        `SELECT source_type, source_id, snippet, occurred_at, created_at
         FROM entity_mentions WHERE entity_id = ? AND user_id = ?
         ORDER BY COALESCE(occurred_at, created_at) DESC LIMIT ?`,
        [params.contact_id, userId, params.timeline_limit]
      );

      const timeline = [
        ...interactions.map((i) => ({
          kind: "interaction" as const,
          at: i.occurred_at,
          direction: i.direction,
          channel: i.channel,
          subject: i.subject,
          body: i.body,
          // The venture as recorded when this happened, not the product's
          // current attachment.
          venture: i.venture_name,
        })),
        ...mentions.map((m) => ({
          kind: "mention" as const,
          at: m.occurred_at ?? m.created_at,
          source_type: m.source_type,
          source_id: m.source_id,
          snippet: m.snippet,
        })),
      ].sort((a, b) => String(b.at).localeCompare(String(a.at)));

      const candidate = getMergeCandidate(entity);

      return ok({
        id: entity.id,
        name: entity.canonical_name,
        type: entity.entity_type,
        resolution: getResolution(entity),
        compartments: getCompartments(entity),
        crm: getCrmFields(entity),
        merge_candidate: candidate,
        channels,
        roles,
        timeline: timeline.slice(0, params.timeline_limit),
      });
    }
  );

  // ─── create_or_merge_contact ───────────────────────────
  server.tool(
    "create_or_merge_contact",
    "Create a contact, or attach to the existing one if the name already resolves. Runs the same merge gate the app uses: a name that matches only after dropping a business suffix creates a separate record flagged for review rather than silently fusing two companies.",
    {
      name: z.string().describe("Contact name as written"),
      entity_type: z
        .enum(["person", "org", "place", "product", "input", "other"])
        .default("person"),
      unresolved: z
        .boolean()
        .default(false)
        .describe(
          "True for an event capture whose real identity is not yet known"
        ),
      met_at: z.string().optional().describe("Where you met, for an unresolved capture"),
      note: z.string().optional().describe("What they said, for an unresolved capture"),
      compartments: z.array(z.string()).optional(),
      email: z.string().optional().describe("Primary email, added as a channel"),
    },
    async (params) => {
      const guard = ctx.guard("crm:write");
      if (!guard.ok) return errorResult(guard);
      const userId = guard.userId;

      try {
        // Goes through the same merge gate as background note extraction, so
        // there is no looser write path into the contact table.
        const result = await ingestSingleEntity(userId, {
          name: params.name,
          type: params.entity_type,
          unresolved: params.unresolved,
          metAt: params.met_at,
          note: params.note,
          compartments: params.compartments,
        });

        if (params.email) {
          const normalized = normalizeChannelValue("email", params.email);
          if (normalized) {
            await db.execute({
              sql: `INSERT OR IGNORE INTO contact_channels
                      (user_id, entity_id, kind, value, normalized_value, is_primary)
                    VALUES (?, ?, 'email', ?, ?, 1)`,
              args: [userId, result.entity.id, params.email.trim(), normalized],
            });
          }
        }

        return ok(result);
      } catch (e) {
        return failure(e);
      }
    }
  );

  // ─── add_contact_channel ───────────────────────────────
  server.tool(
    "add_contact_channel",
    "Add an email, phone, handle, URL or address to a contact. An address can only belong to one contact, which is what makes inbound resolution unambiguous, so a clash is reported rather than overwritten.",
    {
      contact_id: z.string(),
      kind: z.enum(["email", "phone", "handle", "url", "address"]),
      value: z.string(),
      label: z.string().optional().describe("e.g. work, personal, IG"),
      is_primary: z.boolean().default(false),
    },
    async (params) => {
      const guard = ctx.guard("crm:write");
      if (!guard.ok) return errorResult(guard);
      const userId = guard.userId;

      if (!isChannelKind(params.kind)) {
        return failure(new Error(`Unknown channel kind "${params.kind}"`));
      }
      const normalized = normalizeChannelValue(params.kind, params.value);
      if (!normalized) {
        return failure(
          new Error(`"${params.value}" is not a usable ${params.kind}`)
        );
      }

      const clash = await queryOne<{ entity_id: string; canonical_name: string }>(
        `SELECT c.entity_id, e.canonical_name FROM contact_channels c
         JOIN entities e ON e.id = c.entity_id
         WHERE c.user_id = ? AND c.kind = ? AND c.normalized_value = ?`,
        [userId, params.kind, normalized]
      );
      if (clash && clash.entity_id !== params.contact_id) {
        return failure(
          new Error(
            `That ${params.kind} already belongs to "${clash.canonical_name}" (${clash.entity_id})`
          )
        );
      }
      if (clash) return ok({ unchanged: true, normalized_value: normalized });

      await db.execute({
        sql: `INSERT INTO contact_channels
                (user_id, entity_id, kind, value, normalized_value, label, is_primary)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [
          userId,
          params.contact_id,
          params.kind,
          params.value.trim(),
          normalized,
          params.label ?? null,
          params.is_primary ? 1 : 0,
        ],
      });

      return ok({ added: true, normalized_value: normalized });
    }
  );

  // ─── log_interaction ───────────────────────────────────
  server.tool(
    "log_interaction",
    "Record something that actually passed between the user and a contact: a call, email, meeting, DM. Idempotent, so logging the same touch twice produces one row. Distinct from a note mention, which is only a reference.",
    {
      contact_id: z
        .string()
        .optional()
        .describe("Omit for an inbound touch from someone not yet identified"),
      venture_id: z
        .string()
        .optional()
        .describe(
          "Which venture this happened under. Recorded permanently: moving a product later never rewrites it."
        ),
      direction: z.enum(["in", "out", "internal"]).default("in"),
      channel: z
        .enum(["email", "call", "sms", "dm", "meeting", "event", "note", "other"])
        .default("note"),
      occurred_at: z
        .string()
        .optional()
        .describe("ISO timestamp. Defaults to now."),
      subject: z.string().optional(),
      body: z.string().optional(),
      external_id: z
        .string()
        .optional()
        .describe("Message-ID or iCal UID, if there is one. Makes dedup exact."),
    },
    async (params) => {
      const guard = ctx.guard("crm:write");
      if (!guard.ok) return errorResult(guard);

      if (!params.subject && !params.body && !params.external_id) {
        return failure(
          new Error("An interaction needs a subject, a body, or an external_id")
        );
      }

      try {
        const result = await logInteraction(guard.userId, {
          entityId: params.contact_id ?? null,
          ventureId: params.venture_id ?? null,
          direction: params.direction,
          channel: params.channel,
          occurredAt: params.occurred_at,
          subject: params.subject ?? null,
          body: params.body ?? null,
          sourceType: "mcp",
          externalId: params.external_id ?? null,
        });
        return ok({
          deduped: result.deduped,
          interaction: result.interaction,
        });
      } catch (e) {
        return failure(e);
      }
    }
  );

  // ─── set_contact_role ──────────────────────────────────
  server.tool(
    "set_contact_role",
    "Attach a contact to a venture in a named role: partner, collaborator, customer_of, member_of, advisor_to, investor_in, employed_by, reports_to, contact_at. This is what makes a contact show up when filtering by venture. A contact may hold several roles, at several ventures.",
    {
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
      note: z.string().optional().describe("Why, e.g. 'runs their wholesale desk'"),
    },
    async (params) => {
      const guard = ctx.guard("crm:write");
      if (!guard.ok) return errorResult(guard);
      if (!isContactRole(params.role)) {
        return failure(new Error(`"${params.role}" is not a contact role`));
      }
      try {
        await setContactRole(
          guard.userId,
          params.contact_id,
          params.venture_id,
          params.role,
          params.note
        );
        return ok({
          roles: await listContactRoles(guard.userId, params.contact_id),
        });
      } catch (e) {
        return failure(e);
      }
    }
  );

  // ─── remove_contact_role ───────────────────────────────
  server.tool(
    "remove_contact_role",
    "Remove one role a contact holds at a venture. Other roles, and the contact itself, are untouched.",
    {
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
    },
    async (params) => {
      const guard = ctx.guard("crm:write");
      if (!guard.ok) return errorResult(guard);
      if (!isContactRole(params.role)) {
        return failure(new Error(`"${params.role}" is not a contact role`));
      }
      try {
        const removed = await removeContactRole(
          guard.userId,
          params.contact_id,
          params.venture_id,
          params.role
        );
        return ok({
          removed,
          roles: await listContactRoles(guard.userId, params.contact_id),
        });
      } catch (e) {
        return failure(e);
      }
    }
  );

  // ─── list_review_queue ─────────────────────────────────
  server.tool(
    "list_review_queue",
    "Contacts awaiting a human decision: unresolved event captures, and possible duplicates the merge gate refused to fuse automatically. Use before bulk-cleaning contacts after an event.",
    {},
    async () => {
      const guard = ctx.guard("crm:read");
      if (!guard.ok) return errorResult(guard);
      const userId = guard.userId;

      const unresolved = await query<Entity>(
        `SELECT * FROM entities
         WHERE user_id = ? AND metadata LIKE '%"unresolved"%'
         ORDER BY created_at DESC LIMIT 200`,
        [userId]
      );

      const candidates = await listMergeCandidates(userId);

      return ok({
        unresolved: unresolved
          .filter((e) => getResolution(e) === "unresolved")
          .map((e) => ({
            id: e.id,
            name: e.canonical_name,
            hint: readEntityMetadata(e).resolution_hint ?? null,
          })),
        possible_duplicates: candidates.map((c) => ({
          id: c.entity.id,
          name: c.entity.canonical_name,
          possibly_same_as: { id: c.targetId, name: c.targetName },
          reason: c.reason,
          confidence: c.confidence,
        })),
      });
    }
  );

  // ─── resolve_contact ───────────────────────────────────
  server.tool(
    "resolve_contact",
    "Act on the review queue: give an unresolved capture its real name, or merge it into an existing contact. Merging moves mentions, touches, channels and edges, and records the old name as an alias so the merge leaves a trace.",
    {
      contact_id: z.string().describe("The unresolved or flagged contact"),
      merge_into_id: z
        .string()
        .optional()
        .describe("Merge into this contact. Omit to confirm in place."),
      confirmed_name: z
        .string()
        .optional()
        .describe("Real name, when confirming in place"),
    },
    async (params) => {
      const guard = ctx.guard("crm:write");
      if (!guard.ok) return errorResult(guard);
      try {
        const result = await resolveContact(guard.userId, params.contact_id, {
          mergeIntoId: params.merge_into_id ?? null,
          confirmedName: params.confirmed_name ?? null,
        });
        return ok(result);
      } catch (e) {
        return failure(e);
      }
    }
  );

  // ─── merge_contacts ────────────────────────────────────
  server.tool(
    "merge_contacts",
    "Merge one contact into another. Ventures cannot be merged. The venture recorded on past interactions is never changed, so a merge cannot rewrite which venture a touch happened under.",
    {
      winner_id: z.string().describe("The contact to keep"),
      loser_id: z.string().describe("The contact to fold in and delete"),
    },
    async (params) => {
      const guard = ctx.guard("crm:write");
      if (!guard.ok) return errorResult(guard);
      try {
        return ok(
          await mergeEntities(guard.userId, params.winner_id, params.loser_id)
        );
      } catch (e) {
        return failure(e);
      }
    }
  );

  // ─── list_ventures ─────────────────────────────────────
  server.tool(
    "list_ventures",
    "List the user's ventures with contact, product, project and interaction counts, plus any products not assigned to a venture. Call at session start to learn which businesses the user runs.",
    {},
    async () => {
      const guard = ctx.guard("crm:read");
      if (!guard.ok) return errorResult(guard);
      const userId = guard.userId;

      const ventures = await listVentures(userId);
      const unassigned = await listUnassignedProducts(userId);

      return ok({
        ventures: ventures.map((v) => ({
          id: v.entity.id,
          name: v.entity.canonical_name,
          products: v.productCount,
          projects: v.projectCount,
          contacts: v.contactCount,
          interactions: v.interactionCount,
          // Phase 3 reads these when drafting. Surfaced now so an external
          // agent writing outbound copy can honor them today.
          voice: readEntityMetadata(v.entity).venture?.voice ?? null,
          compliance_rules:
            readEntityMetadata(v.entity).venture?.compliance_rules ?? [],
          sending_identity:
            readEntityMetadata(v.entity).venture?.sending_identity ?? null,
        })),
        unassigned_products: unassigned.map((p) => ({
          id: p.id,
          name: p.canonical_name,
        })),
      });
    }
  );

  // ─── list_venture_members ──────────────────────────────
  server.tool(
    "list_venture_members",
    "The products and projects belonging to one venture.",
    { venture_id: z.string() },
    async (params) => {
      const guard = ctx.guard("crm:read");
      if (!guard.ok) return errorResult(guard);
      try {
        const { products, projects } = await listVentureMembers(
          guard.userId,
          params.venture_id
        );
        return ok({
          products: products.map((p) => ({ id: p.id, name: p.canonical_name })),
          projects: projects.map((p) => ({ id: p.id, name: p.name })),
        });
      } catch (e) {
        return failure(e);
      }
    }
  );

  // ─── create_venture ────────────────────────────────────
  server.tool(
    "create_venture",
    "Create a venture. If an entity with that name already exists in the knowledge graph it is adopted, keeping its mention history rather than creating a duplicate.",
    {
      name: z.string(),
      voice: z.string().optional().describe("How outbound for this venture should read"),
      compliance_rules: z
        .array(z.string())
        .optional()
        .describe("Rules a drafting agent must not violate"),
      compartments: z.array(z.string()).optional(),
      sending_email: z.string().optional(),
    },
    async (params) => {
      const guard = ctx.guard("crm:write");
      if (!guard.ok) return errorResult(guard);
      try {
        const result = await createVenture(guard.userId, {
          name: params.name,
          voice: params.voice,
          complianceRules: params.compliance_rules,
          compartments: params.compartments,
          sendingIdentity: params.sending_email
            ? { email: params.sending_email }
            : undefined,
        });
        return ok({
          id: result.entity.id,
          name: result.entity.canonical_name,
          adopted: result.adopted,
          mentions_kept: result.adopted ? result.entity.mention_count : 0,
        });
      } catch (e) {
        return failure(e);
      }
    }
  );

  // ─── create_product ────────────────────────────────────
  server.tool(
    "create_product",
    "Create a product, optionally attached to a venture. A product belongs to one venture at a time and can be moved later without affecting the history of past interactions.",
    {
      name: z.string(),
      venture_id: z.string().optional(),
      sku: z.string().optional(),
    },
    async (params) => {
      const guard = ctx.guard("crm:write");
      if (!guard.ok) return errorResult(guard);
      try {
        const result = await createProduct(guard.userId, {
          name: params.name,
          ventureId: params.venture_id ?? null,
          sku: params.sku,
        });
        return ok({
          id: result.entity.id,
          name: result.entity.canonical_name,
          adopted: result.adopted,
        });
      } catch (e) {
        return failure(e);
      }
    }
  );

  // ─── move_to_venture ───────────────────────────────────
  server.tool(
    "move_to_venture",
    "Move a product or project to another venture, or detach it with a null venture. Past interactions keep the venture they were logged under: a move never rewrites history.",
    {
      kind: z.enum(["product", "project"]),
      id: z.string().describe("Product entity ID or project ID"),
      venture_id: z
        .string()
        .nullable()
        .describe("Target venture, or null to unassign"),
    },
    async (params) => {
      const guard = ctx.guard("crm:write");
      if (!guard.ok) return errorResult(guard);
      try {
        await moveToVenture(
          guard.userId,
          params.kind,
          params.id,
          params.venture_id
        );
        return ok({
          moved: true,
          history_preserved: true,
          message:
            "Moved. Past interactions keep the venture they were logged under.",
        });
      } catch (e) {
        return failure(e);
      }
    }
  );

  // ─── export_crm ────────────────────────────────────────
  server.tool(
    "export_crm",
    "Export the CRM as JSON or CSV: contacts with channels, roles and compartments, plus interactions. The user's data stays portable.",
    {
      format: z.enum(["json", "csv"]).default("json"),
      include_interactions: z.boolean().default(true),
    },
    async (params) => {
      const guard = ctx.guard("crm:read");
      if (!guard.ok) return errorResult(guard);
      const userId = guard.userId;

      const entities = await query<Entity>(
        `SELECT * FROM entities WHERE user_id = ?
         ORDER BY canonical_name COLLATE NOCASE`,
        [userId]
      );
      const channels = await query<ContactChannel>(
        `SELECT * FROM contact_channels WHERE user_id = ?`,
        [userId]
      );
      const roles = await query<{
        source_entity_id: string;
        target_entity_id: string;
        edge_type: string;
      }>(
        `SELECT source_entity_id, target_entity_id, edge_type FROM entity_edges
         WHERE user_id = ? AND edge_type <> 'related'`,
        [userId]
      );
      const interactions = params.include_interactions
        ? await query<Interaction>(
            `SELECT * FROM interactions WHERE user_id = ? ORDER BY occurred_at DESC`,
            [userId]
          )
        : [];

      const nameById = new Map(entities.map((e) => [e.id, e.canonical_name]));

      const contacts = entities.map((e) => ({
        id: e.id,
        name: e.canonical_name,
        type: e.entity_type,
        is_venture: isVenture(e),
        resolution: getResolution(e),
        compartments: getCompartments(e).join("|"),
        mentions: e.mention_count,
        channels: channels
          .filter((c) => c.entity_id === e.id)
          .map((c) => `${c.kind}:${c.value}`)
          .join("|"),
        roles: roles
          .filter((r) => r.source_entity_id === e.id)
          .map((r) => `${r.edge_type}@${nameById.get(r.target_entity_id) ?? "?"}`)
          .join("|"),
      }));

      if (params.format === "csv") {
        return ok({
          contacts_csv: toCsv(contacts),
          interactions_csv: params.include_interactions
            ? toCsv(
                interactions.map((i) => ({
                  occurred_at: i.occurred_at,
                  contact: i.entity_id ? (nameById.get(i.entity_id) ?? "") : "",
                  venture: i.venture_id
                    ? (nameById.get(i.venture_id) ?? "")
                    : "",
                  direction: i.direction,
                  channel: i.channel,
                  subject: i.subject ?? "",
                }))
              )
            : "",
        });
      }

      return ok({ contacts, interactions });
    }
  );
}

/** Minimal RFC 4180 CSV: quote everything, double internal quotes. */
function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) =>
    `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [
    headers.map(escape).join(","),
    ...rows.map((row) => headers.map((h) => escape(row[h])).join(",")),
  ].join("\n");
}
