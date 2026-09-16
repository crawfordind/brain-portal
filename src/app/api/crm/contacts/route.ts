/**
 * GET /api/crm/contacts — the Rolodex.
 *
 * Filters: ?venture= ?type= ?compartment= ?resolution= ?q= ?limit=
 *
 * Unresolved contacts are excluded by default. They are placeholders like
 * "Rascal" or "Matt in Carlisle" captured at an event, and surfacing them in
 * the ordinary list would make it look full of junk. Ask for them explicitly
 * with resolution=unresolved, or resolution=all.
 */

import { NextRequest, NextResponse } from "next/server";
import { queryAll } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";
import type { Entity } from "@/lib/db/schema";
import { ENTITY_TYPES } from "@/lib/entities/resolve";
import {
  getCompartments,
  getResolution,
  getMergeCandidate,
  isVenture,
} from "@/lib/crm/metadata";

export interface ContactListItem {
  entity: Entity;
  compartments: string[];
  resolution: "unresolved" | "confirmed";
  needsReview: boolean;
  channels: { kind: string; value: string; is_primary: number }[];
  roles: { ventureId: string; ventureName: string; edgeType: string }[];
  lastInteractionAt: string | null;
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const sp = request.nextUrl.searchParams;
    const type = sp.get("type");
    const ventureId = sp.get("venture");
    const compartment = sp.get("compartment")?.trim().toLowerCase();
    const resolution = sp.get("resolution") ?? "confirmed";
    const q = sp.get("q")?.trim();
    const limit = Math.min(parseInt(sp.get("limit") || "100", 10) || 100, 500);

    // Arguments are pushed in the same order their placeholders appear.
    const args: (string | number)[] = [];
    let sql = `SELECT DISTINCT e.* FROM entities e`;

    if (ventureId) {
      sql += ` JOIN entity_edges ve ON ve.source_entity_id = e.id
                 AND ve.target_entity_id = ? AND ve.edge_type <> 'part_of'`;
      args.push(ventureId);
    }

    sql += ` WHERE e.user_id = ?`;
    args.push(user.id);

    if (type && (ENTITY_TYPES as readonly string[]).includes(type)) {
      sql += ` AND e.entity_type = ?`;
      args.push(type);
    }
    if (q) {
      sql += ` AND e.canonical_name LIKE ?`;
      args.push(`%${q}%`);
    }

    sql += ` ORDER BY e.mention_count DESC, e.last_seen_at DESC LIMIT ?`;
    args.push(limit);

    const rows = await queryAll<Entity>(sql, args);

    // Compartment and resolution live in JSON, so filter them in TypeScript
    // where the documented defaults (absent = confirmed, absent = public)
    // apply consistently.
    const filtered = rows.filter((entity) => {
      if (isVenture(entity)) return false;
      const state = getResolution(entity);
      if (resolution === "confirmed" && state !== "confirmed") return false;
      if (resolution === "unresolved" && state !== "unresolved") return false;
      if (compartment && !getCompartments(entity).includes(compartment)) {
        return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      return NextResponse.json({ contacts: [] });
    }

    const ids = filtered.map((e) => e.id);
    const placeholders = ids.map(() => "?").join(",");

    const channels = await queryAll<{
      entity_id: string;
      kind: string;
      value: string;
      is_primary: number;
    }>(
      `SELECT entity_id, kind, value, is_primary FROM contact_channels
       WHERE user_id = ? AND entity_id IN (${placeholders})
       ORDER BY is_primary DESC, kind`,
      [user.id, ...ids]
    );

    const roles = await queryAll<{
      source_entity_id: string;
      target_entity_id: string;
      canonical_name: string;
      edge_type: string;
    }>(
      `SELECT ed.source_entity_id, ed.target_entity_id, v.canonical_name, ed.edge_type
       FROM entity_edges ed
       JOIN entities v ON v.id = ed.target_entity_id
       WHERE ed.user_id = ? AND ed.source_entity_id IN (${placeholders})
         AND ed.edge_type <> 'part_of' AND v.metadata LIKE '%"is_venture"%'`,
      [user.id, ...ids]
    );

    const lastTouches = await queryAll<{ entity_id: string; last_at: string }>(
      `SELECT entity_id, MAX(occurred_at) AS last_at FROM interactions
       WHERE user_id = ? AND entity_id IN (${placeholders})
       GROUP BY entity_id`,
      [user.id, ...ids]
    );

    const contacts: ContactListItem[] = filtered.map((entity) => ({
      entity,
      compartments: getCompartments(entity),
      resolution: getResolution(entity),
      needsReview: getMergeCandidate(entity) !== null,
      channels: channels
        .filter((c) => c.entity_id === entity.id)
        .map(({ kind, value, is_primary }) => ({ kind, value, is_primary })),
      roles: roles
        .filter((r) => r.source_entity_id === entity.id)
        .map((r) => ({
          ventureId: r.target_entity_id,
          ventureName: r.canonical_name,
          edgeType: r.edge_type,
        })),
      lastInteractionAt:
        lastTouches.find((t) => t.entity_id === entity.id)?.last_at ?? null,
    }));

    return NextResponse.json({ contacts });
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch contacts" },
      { status: 500 }
    );
  }
}
