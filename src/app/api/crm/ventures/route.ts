/**
 * Ventures: list with counts, and create.
 *
 * POST adopts an existing entity holding the same key rather than 409ing, since
 * a venture's name is usually already in the graph with real mention history.
 * The response says which happened via `adopted`.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  listVentures,
  createVenture,
  listUnassignedProducts,
  StructureError,
} from "@/lib/crm/structure";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [ventures, unassignedProducts] = await Promise.all([
      listVentures(user.id),
      listUnassignedProducts(user.id),
    ]);
    return NextResponse.json({ ventures, unassignedProducts });
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch ventures" },
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
    const result = await createVenture(user.id, {
      name: String(body.name ?? ""),
      slug: body.slug,
      sendingIdentity: body.sendingIdentity,
      voice: body.voice,
      complianceRules: body.complianceRules,
      compartments: body.compartments,
    });
    return NextResponse.json(result, { status: result.adopted ? 200 : 201 });
  } catch (e) {
    if (e instanceof StructureError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json(
      { error: "Failed to create venture" },
      { status: 500 }
    );
  }
}
