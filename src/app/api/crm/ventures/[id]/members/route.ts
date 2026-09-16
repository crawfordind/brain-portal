/**
 * GET /api/crm/ventures/[id]/members
 *
 * A venture's products and projects in one response, through the structure
 * module, so the caller never has to know that one lives in the entity graph
 * and the other in the projects table.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { listVentureMembers, StructureError } from "@/lib/crm/structure";

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
    const { products, projects } = await listVentureMembers(user.id, id);
    return NextResponse.json({
      members: [
        ...products.map((p) => ({
          id: p.id,
          name: p.canonical_name,
          kind: "product" as const,
        })),
        ...projects.map((p) => ({
          id: p.id,
          name: p.name,
          kind: "project" as const,
        })),
      ],
    });
  } catch (e) {
    if (e instanceof StructureError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json(
      { error: "Failed to fetch venture members" },
      { status: 500 }
    );
  }
}
