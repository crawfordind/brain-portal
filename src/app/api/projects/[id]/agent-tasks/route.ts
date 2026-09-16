import { NextRequest, NextResponse } from "next/server";
import { queryAll } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";
import { AgentTask } from "@/lib/db/schema";
import { getProjectAccess } from "@/lib/permissions";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const access = await getProjectAccess(id, user.id);
  if (!access) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') || 'all';
  const type = searchParams.get('type') || 'all';

  let query = `SELECT * FROM agent_tasks WHERE project_id = ?`;
  const args: (string | number)[] = [id];

  if (status !== 'all') {
    query += ` AND status = ?`;
    args.push(status);
  }

  if (type !== 'all') {
    query += ` AND task_type = ?`;
    args.push(type);
  }

  query += ` ORDER BY created_at DESC LIMIT 100`;

  const agentTasks = await queryAll<AgentTask>(query, args);

  return NextResponse.json({ agentTasks });
}
