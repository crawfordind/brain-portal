import { NextRequest, NextResponse } from "next/server";
import { queryAll } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";
import type { Entity } from "@/lib/db/schema";
import { ENTITY_TYPES } from "@/lib/entities/resolve";

// GET /api/entities — list canonical entities for the current user.
// Query params: ?type=person|org|...  ?q=<search>  ?limit=<n>
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const sp = request.nextUrl.searchParams;
    const type = sp.get("type");
    const q = sp.get("q");
    const limit = Math.min(parseInt(sp.get("limit") || "50", 10) || 50, 200);

    let sql = `SELECT * FROM entities WHERE user_id = ?`;
    const args: (string | number)[] = [user.id];

    if (type && (ENTITY_TYPES as readonly string[]).includes(type)) {
      sql += ` AND entity_type = ?`;
      args.push(type);
    }
    if (q && q.trim()) {
      sql += ` AND canonical_name LIKE ?`;
      args.push(`%${q.trim()}%`);
    }

    sql += ` ORDER BY mention_count DESC, last_seen_at DESC LIMIT ?`;
    args.push(limit);

    const entities = await queryAll<Entity>(sql, args);
    return NextResponse.json({ entities });
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch entities" },
      { status: 500 }
    );
  }
}
