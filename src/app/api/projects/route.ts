import { NextRequest, NextResponse } from "next/server";
import { db, queryAll, queryOne } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";
import { Project } from "@/lib/db/schema";

// GET /api/projects - List all projects
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const status = searchParams.get("status");
  const includeArchived = searchParams.get("includeArchived") === "true";

  // Aggregate counts once per related table rather than running a correlated
  // scalar subquery for every project row (N+1 elimination).
  let query = `
    SELECT
      p.*,
      COALESCE(nc.note_count, 0) as note_count,
      COALESCE(tc.open_task_count, 0) as open_task_count
    FROM projects p
    LEFT JOIN (
      SELECT project_id, COUNT(*) as note_count
      FROM notes
      WHERE project_id IS NOT NULL
      GROUP BY project_id
    ) nc ON nc.project_id = p.id
    LEFT JOIN (
      SELECT project_id, COUNT(*) as open_task_count
      FROM tasks
      WHERE project_id IS NOT NULL AND status != 'completed'
      GROUP BY project_id
    ) tc ON tc.project_id = p.id
    WHERE p.user_id = ?
  `;
  const args: (string | number)[] = [user.id];

  if (status) {
    query += " AND p.status = ?";
    args.push(status);
  }

  if (!includeArchived) {
    query += " AND p.status != 'archived'";
  }

  query += " ORDER BY p.priority DESC, p.updated_at DESC";

  const projects = await queryAll<Project & { note_count: number; open_task_count: number }>(query, args);

  // Also fetch shared projects (table may not exist if migration hasn't run)
  let sharedProjects: (Project & { note_count: number; open_task_count: number; collab_role: string; owner_email: string })[] = [];
  try {
    sharedProjects = await queryAll<
      Project & { note_count: number; open_task_count: number; collab_role: string; owner_email: string }
    >(
      `SELECT
        p.*,
        COALESCE(nc.note_count, 0) as note_count,
        COALESCE(tc.open_task_count, 0) as open_task_count,
        pc.role as collab_role,
        u.email as owner_email
      FROM projects p
      JOIN project_collaborators pc ON pc.project_id = p.id
      JOIN users u ON p.user_id = u.id
      LEFT JOIN (
        SELECT project_id, COUNT(*) as note_count
        FROM notes
        WHERE project_id IS NOT NULL
        GROUP BY project_id
      ) nc ON nc.project_id = p.id
      LEFT JOIN (
        SELECT project_id, COUNT(*) as open_task_count
        FROM tasks
        WHERE project_id IS NOT NULL AND status != 'completed'
        GROUP BY project_id
      ) tc ON tc.project_id = p.id
      WHERE pc.user_id = ? AND pc.status = 'accepted'
        AND p.status != 'archived'
      ORDER BY p.updated_at DESC`,
      [user.id]
    );
  } catch {
    // Table doesn't exist yet — that's fine, just return empty
  }

  return NextResponse.json({ projects, sharedProjects });
}

// POST /api/projects - Create a new project
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { name, description, status = "active", color, icon, parentId } = body;

  if (!name?.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  // Validate parentId if provided
  if (parentId) {
    const parentProject = await queryOne<Project>(
      "SELECT id FROM projects WHERE id = ? AND user_id = ?",
      [parentId, user.id]
    );
    if (!parentProject) {
      return NextResponse.json({ error: "Parent project not found" }, { status: 400 });
    }
  }

  // Generate slug from name (include parent context for uniqueness)
  const baseSlug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  // Check for existing slugs and make unique if needed
  const existing = await queryAll<{ slug: string }>(
    "SELECT slug FROM projects WHERE user_id = ? AND slug LIKE ?",
    [user.id, `${baseSlug}%`]
  );

  let slug = baseSlug;
  if (existing.length > 0) {
    const slugs = new Set(existing.map(p => p.slug));
    let counter = 1;
    while (slugs.has(slug)) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }
  }

  await db.execute({
    sql: `
      INSERT INTO projects (user_id, name, slug, description, status, color, icon, parent_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [user.id, name.trim(), slug, description || null, status, color || null, icon || null, parentId || null],
  });

  const project = await queryOne<Project>(
    "SELECT * FROM projects WHERE user_id = ? AND slug = ?",
    [user.id, slug]
  );

  return NextResponse.json({ project }, { status: 201 });
}
