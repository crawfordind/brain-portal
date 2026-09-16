/**
 * GET /api/crm/contacts/[id] — the contact brief.
 *
 * Everything needed before a call: who they are, how to reach them, which
 * ventures they are attached to and in what role, and one chronological
 * timeline merging note mentions with actual touches.
 *
 * Mentions and interactions are deliberately merged rather than shown as two
 * lists: "what I wrote about them" and "what passed between us" are both part
 * of the same story, and separating them makes the sequence unreadable.
 */

import { NextRequest, NextResponse } from "next/server";
import { queryOne, queryAll } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";
import type { ContactChannel, Entity, Interaction } from "@/lib/db/schema";
import {
  getCompartments,
  getCrmFields,
  getMergeCandidate,
  getResolution,
  readEntityMetadata,
} from "@/lib/crm/metadata";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export type TimelineEntry =
  | {
      kind: "interaction";
      at: string;
      id: string;
      direction: string;
      channel: string;
      subject: string | null;
      body: string | null;
      ventureId: string | null;
      ventureName: string | null;
    }
  | {
      kind: "mention";
      at: string;
      id: string;
      sourceType: string;
      sourceId: string;
      snippet: string | null;
    };

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
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }

    const channels = await queryAll<ContactChannel>(
      `SELECT * FROM contact_channels WHERE entity_id = ? AND user_id = ?
       ORDER BY is_primary DESC, kind, created_at`,
      [id, user.id]
    );

    const roles = await queryAll<{
      venture_id: string;
      venture_name: string;
      edge_type: string;
      reason: string | null;
    }>(
      `SELECT ed.target_entity_id AS venture_id, v.canonical_name AS venture_name,
              ed.edge_type, ed.reason
       FROM entity_edges ed
       JOIN entities v ON v.id = ed.target_entity_id
       WHERE ed.user_id = ? AND ed.source_entity_id = ?
         AND ed.edge_type <> 'part_of' AND v.metadata LIKE '%"is_venture"%'
       ORDER BY v.canonical_name COLLATE NOCASE`,
      [user.id, id]
    );

    const interactions = await queryAll<
      Interaction & { venture_name: string | null }
    >(
      `SELECT i.*, v.canonical_name AS venture_name
       FROM interactions i
       LEFT JOIN entities v ON v.id = i.venture_id
       WHERE i.user_id = ? AND i.entity_id = ?
       ORDER BY i.occurred_at DESC
       LIMIT 200`,
      [user.id, id]
    );

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
       LIMIT 200`,
      [id, user.id]
    );

    const timeline: TimelineEntry[] = [
      ...interactions.map(
        (i): TimelineEntry => ({
          kind: "interaction",
          at: i.occurred_at,
          id: i.id,
          direction: i.direction,
          channel: i.channel,
          subject: i.subject,
          body: i.body,
          ventureId: i.venture_id,
          // The venture as recorded when this happened, not as the product's
          // current attachment. See src/lib/crm/structure.ts.
          ventureName: i.venture_name,
        })
      ),
      ...mentions.map(
        (m): TimelineEntry => ({
          kind: "mention",
          at: m.occurred_at ?? m.created_at,
          id: m.id,
          sourceType: m.source_type,
          sourceId: m.source_id,
          snippet: m.snippet,
        })
      ),
    ].sort((a, b) => b.at.localeCompare(a.at));

    const mergeCandidate = getMergeCandidate(entity);
    let mergeCandidateName: string | null = null;
    if (mergeCandidate) {
      const other = await queryOne<{ canonical_name: string }>(
        `SELECT canonical_name FROM entities WHERE id = ? AND user_id = ?`,
        [mergeCandidate.target_entity_id, user.id]
      );
      mergeCandidateName = other?.canonical_name ?? null;
    }

    return NextResponse.json({
      entity,
      metadata: readEntityMetadata(entity),
      compartments: getCompartments(entity),
      resolution: getResolution(entity),
      crm: getCrmFields(entity),
      mergeCandidate: mergeCandidate
        ? { ...mergeCandidate, targetName: mergeCandidateName }
        : null,
      channels,
      roles,
      timeline,
      counts: {
        interactions: interactions.length,
        mentions: mentions.length,
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch contact" },
      { status: 500 }
    );
  }
}
