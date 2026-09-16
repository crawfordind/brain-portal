/**
 * Products: list (optionally by venture) and create.
 *
 * A product with no venture is unassigned, which is a valid state. It is
 * returned under a null venture rather than hidden, so nothing gets lost.
 */

import { NextRequest, NextResponse } from "next/server";
import { queryAll } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";
import type { Entity } from "@/lib/db/schema";
import {
  createProduct,
  listUnassignedProducts,
  StructureError,
} from "@/lib/crm/structure";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ventureId = request.nextUrl.searchParams.get("venture");

  try {
    if (ventureId === "none") {
      return NextResponse.json({ products: await listUnassignedProducts(user.id) });
    }

    if (ventureId) {
      const products = await queryAll<Entity>(
        `SELECT e.* FROM entities e
         JOIN entity_edges ed ON ed.source_entity_id = e.id
         WHERE ed.user_id = ? AND ed.edge_type = 'part_of' AND ed.target_entity_id = ?
         ORDER BY e.canonical_name COLLATE NOCASE`,
        [user.id, ventureId]
      );
      return NextResponse.json({ products });
    }

    const products = await queryAll<Entity & { venture_id: string | null; venture_name: string | null }>(
      `SELECT e.*, ed.target_entity_id AS venture_id, v.canonical_name AS venture_name
       FROM entities e
       LEFT JOIN entity_edges ed
         ON ed.source_entity_id = e.id AND ed.edge_type = 'part_of'
       LEFT JOIN entities v ON v.id = ed.target_entity_id
       WHERE e.user_id = ? AND e.entity_type = 'product'
       ORDER BY e.canonical_name COLLATE NOCASE`,
      [user.id]
    );
    return NextResponse.json({ products });
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch products" },
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
    const result = await createProduct(user.id, {
      name: String(body.name ?? ""),
      ventureId: body.ventureId ?? null,
      sku: body.sku,
      compartments: body.compartments,
    });
    return NextResponse.json(result, { status: result.adopted ? 200 : 201 });
  } catch (e) {
    if (e instanceof StructureError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json(
      { error: "Failed to create product" },
      { status: 500 }
    );
  }
}
