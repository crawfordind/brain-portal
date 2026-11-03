import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getTemplate, recordTemplateUse } from "@/lib/templates/store";
import { templateErrorResponse } from "@/lib/templates/http";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/templates/[id]/use - count a use (the picker ranks by it)
export async function POST(_request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    await getTemplate(id, user.id);
    await recordTemplateUse(id, user.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return templateErrorResponse(error, "Couldn't record the use");
  }
}
