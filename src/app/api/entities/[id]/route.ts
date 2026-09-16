import { NextRequest, NextResponse } from "next/server";
import { queryOne, queryAll } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";
import type { Entity } from "@/lib/db/schema";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/entities/[id] — entity detail with its mention timeline (temporal
// reasoning) and typed-edge neighbors (the knowledge graph around it).
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const entity = await queryOne<Entity>(
      `SELECT * FROM entities WHERE id = ? AND user_id = ?`,
      [id, user.id]
    );
    if (!entity) {
      return NextResponse.json({ error: "Entity not found" }, { status: 404 });
    }

    // Mention timeline — ordered newest first, dated by the source when known.
    const mentions = await queryAll<{
      id: string;
      source_type: string;
      source_id: string;
      snippet: string | null;
      occurred_at: string | null;
      created_at: string;
    }>(
      `SELECT id, source_type, source_id, snippet, occurred_at, created_at
       FROM entity_mentions
       WHERE entity_id = ? AND user_id = ?
       ORDER BY COALESCE(occurred_at, created_at) DESC
       LIMIT 100`,
      [id, user.id]
    );

    // Typed-edge neighbors (both directions), strongest first.
    const edges = await queryAll<{
      edge_type: string;
      strength: number;
      co_occurrence_count: number;
      reason: string | null;
      direction: "out" | "in";
      neighbor_id: string;
      neighbor_name: string;
      neighbor_type: string;
    }>(
      `SELECT ee.edge_type, ee.strength, ee.co_occurrence_count, ee.reason,
              CASE WHEN ee.source_entity_id = ? THEN 'out' ELSE 'in' END AS direction,
              ne.id AS neighbor_id, ne.canonical_name AS neighbor_name, ne.entity_type AS neighbor_type
       FROM entity_edges ee
       JOIN entities ne ON ne.id = CASE
         WHEN ee.source_entity_id = ? THEN ee.target_entity_id
         ELSE ee.source_entity_id END
       WHERE ee.user_id = ? AND (ee.source_entity_id = ? OR ee.target_entity_id = ?)
       ORDER BY ee.strength DESC, ee.co_occurrence_count DESC
       LIMIT 50`,
      [id, id, user.id, id, id]
    );

    return NextResponse.json({ entity, mentions, edges });
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch entity" },
      { status: 500 }
    );
  }
}
