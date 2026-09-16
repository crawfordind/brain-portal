/**
 * Interaction logging.
 *
 * POST is idempotent through the natural key, so a client retrying, a mail
 * poller delivering twice, or four captures of one meeting all produce one row.
 * The response says which happened via `deduped`.
 */

import { NextRequest, NextResponse } from "next/server";
import { queryAll } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";
import type { Interaction } from "@/lib/db/schema";
import { logInteraction } from "@/lib/crm/interactions";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const entityId = sp.get("entityId");
  const ventureId = sp.get("ventureId");
  const limit = Math.min(parseInt(sp.get("limit") || "100", 10) || 100, 500);

  try {
    const args: (string | number)[] = [user.id];
    let sql = `SELECT * FROM interactions WHERE user_id = ?`;
    if (entityId) {
      sql += ` AND entity_id = ?`;
      args.push(entityId);
    }
    if (ventureId) {
      sql += ` AND venture_id = ?`;
      args.push(ventureId);
    }
    sql += ` ORDER BY occurred_at DESC LIMIT ?`;
    args.push(limit);

    const interactions = await queryAll<Interaction>(sql, args);
    return NextResponse.json({ interactions });
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch interactions" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();

    if (!body.subject && !body.body && !body.externalId) {
      return NextResponse.json(
        { error: "An interaction needs a subject, a body, or an external id" },
        { status: 400 }
      );
    }

    const result = await logInteraction(user.id, {
      entityId: body.entityId ?? null,
      ventureId: body.ventureId ?? null,
      dealId: body.dealId ?? null,
      direction: body.direction,
      channel: body.channel,
      occurredAt: body.occurredAt,
      subject: body.subject ?? null,
      body: body.body ?? null,
      sourceType: body.sourceType ?? "manual",
      sourceId: body.sourceId ?? null,
      externalId: body.externalId ?? null,
      metadata: body.metadata,
    });

    return NextResponse.json(result, { status: result.deduped ? 200 : 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to log interaction";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
