/**
 * Contact channel CRUD.
 *
 * POST normalizes before storing and 409s on a cross-entity collision, naming
 * the entity that already owns the address rather than silently overwriting.
 * That uniqueness is not a nicety: it is what makes inbound resolution
 * unambiguous for every later intake path.
 */

import { NextRequest, NextResponse } from "next/server";
import { db, queryOne, queryAll } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";
import type { ContactChannel, Entity } from "@/lib/db/schema";
import { isChannelKind, normalizeChannelValue } from "@/lib/crm/channels";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  try {
    const channels = await queryAll<ContactChannel>(
      `SELECT * FROM contact_channels WHERE entity_id = ? AND user_id = ?
       ORDER BY is_primary DESC, kind`,
      [id, user.id]
    );
    return NextResponse.json({ channels });
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch channels" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  try {
    const body = await request.json();
    const kind = String(body.kind ?? "");
    const rawValue = String(body.value ?? "");

    if (!isChannelKind(kind)) {
      return NextResponse.json(
        { error: `Unknown channel kind "${kind}"` },
        { status: 400 }
      );
    }

    const normalized = normalizeChannelValue(kind, rawValue);
    if (!normalized) {
      return NextResponse.json(
        { error: `"${rawValue}" is not a usable ${kind}` },
        { status: 400 }
      );
    }

    const entity = await queryOne<Entity>(
      `SELECT id FROM entities WHERE id = ? AND user_id = ?`,
      [id, user.id]
    );
    if (!entity) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }

    const clash = await queryOne<{ entity_id: string; canonical_name: string }>(
      `SELECT c.entity_id, e.canonical_name FROM contact_channels c
       JOIN entities e ON e.id = c.entity_id
       WHERE c.user_id = ? AND c.kind = ? AND c.normalized_value = ?`,
      [user.id, kind, normalized]
    );
    if (clash && clash.entity_id !== id) {
      return NextResponse.json(
        {
          error: `That ${kind} already belongs to "${clash.canonical_name}"`,
          conflictEntityId: clash.entity_id,
        },
        { status: 409 }
      );
    }
    if (clash) {
      return NextResponse.json({ channel: clash, unchanged: true });
    }

    if (body.is_primary) {
      await db.execute({
        sql: `UPDATE contact_channels SET is_primary = 0
              WHERE user_id = ? AND entity_id = ? AND kind = ?`,
        args: [user.id, id, kind],
      });
    }

    await db.execute({
      sql: `INSERT INTO contact_channels
              (user_id, entity_id, kind, value, normalized_value, label, is_primary, verified)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        user.id,
        id,
        kind,
        rawValue.trim(),
        normalized,
        body.label ?? null,
        body.is_primary ? 1 : 0,
        body.verified ? 1 : 0,
      ],
    });

    const channel = await queryOne<ContactChannel>(
      `SELECT * FROM contact_channels
       WHERE user_id = ? AND kind = ? AND normalized_value = ?`,
      [user.id, kind, normalized]
    );

    return NextResponse.json({ channel }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Failed to add channel" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const channelId = request.nextUrl.searchParams.get("channelId");

  if (!channelId) {
    return NextResponse.json({ error: "channelId is required" }, { status: 400 });
  }

  try {
    const result = await db.execute({
      sql: `DELETE FROM contact_channels WHERE id = ? AND entity_id = ? AND user_id = ?`,
      args: [channelId, id, user.id],
    });
    if (result.rowsAffected === 0) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Failed to delete channel" },
      { status: 500 }
    );
  }
}
