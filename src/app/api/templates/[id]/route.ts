import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { deleteTemplate, getTemplate, updateTemplate } from "@/lib/templates/store";
import { readJsonBody, templateErrorResponse } from "@/lib/templates/http";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    return NextResponse.json({ template: await getTemplate(id, user.id) });
  } catch (error) {
    return templateErrorResponse(error, "Couldn't load the template");
  }
}

// PATCH /api/templates/[id] - any of { name, description, title_pattern, content, project_id }
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await readJsonBody(request);
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  const { id } = await params;
  try {
    return NextResponse.json({ template: await updateTemplate(id, user.id, body) });
  } catch (error) {
    return templateErrorResponse(error, "Couldn't update the template");
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    await deleteTemplate(id, user.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return templateErrorResponse(error, "Couldn't delete the template");
  }
}
