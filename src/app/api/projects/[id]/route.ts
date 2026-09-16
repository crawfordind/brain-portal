import { NextRequest, NextResponse } from "next/server";
import { db, queryAll, queryOne } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";
import { Project, Note, Task } from "@/lib/db/schema";
import { getProjectAccess, getProjectAccessBySlug, canEdit, isOwner } from "@/lib/permissions";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// UUIDs are 36 chars with dashes at positions 8,13,18,23. Anything else is a slug.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/projects/[id] - Get a single project with related data.
// The [id] path segment accepts either a project UUID or a project slug, so
// the project detail page can fetch everything in a single round-trip.
export async function GET(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const access = UUID_RE.test(id)
      ? await getProjectAccess(id, user.id)
      : await getProjectAccessBySlug(id, user.id);

    if (!access) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const projectId = access.project.id;

    const [notes, tasks] = await Promise.all([
      queryAll<Note>(
        `SELECT id, title, slug, note_type, word_count, is_pinned, created_at, updated_at
         FROM notes WHERE project_id = ? ORDER BY is_pinned DESC, updated_at DESC LIMIT 20`,
        [projectId]
      ),
      queryAll<Task>(
        `SELECT * FROM tasks WHERE project_id = ? ORDER BY
          CASE status WHEN 'in_progress' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
          CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
          created_at DESC
          LIMIT 200`,
        [projectId]
      ),
    ]);

    return NextResponse.json({ project: access.project, role: access.role, notes, tasks });
  } catch (error) {
    console.error("[API] GET /api/projects/[id] failed:", error);
    return NextResponse.json({ error: "Failed to fetch project" }, { status: 500 });
  }
}

// PUT /api/projects/[id] - Update a project
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const access = await getProjectAccess(id, user.id);

    if (!canEdit(access)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const updates: string[] = [];
    const args: (string | number | null)[] = [];

    if (body.name !== undefined) {
      if (!isOwner(access)) {
        return NextResponse.json({ error: "Only the owner can rename the project" }, { status: 403 });
      }
      updates.push("name = ?");
      args.push(body.name.trim());

      const baseSlug = body.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");

      const existingSlugs = await queryAll<{ slug: string }>(
        "SELECT slug FROM projects WHERE user_id = ? AND slug LIKE ? AND id != ?",
        [access!.project.user_id, `${baseSlug}%`, id]
      );

      let slug = baseSlug;
      if (existingSlugs.length > 0) {
        const slugs = new Set(existingSlugs.map(p => p.slug));
        let counter = 1;
        while (slugs.has(slug)) {
          slug = `${baseSlug}-${counter}`;
          counter++;
        }
      }
      updates.push("slug = ?");
      args.push(slug);
    }

    if (body.description !== undefined) {
      updates.push("description = ?");
      args.push(body.description || null);
    }

    if (body.status !== undefined) {
      updates.push("status = ?");
      args.push(body.status);
    }

    if (body.color !== undefined) {
      updates.push("color = ?");
      args.push(body.color || null);
    }

    if (body.icon !== undefined) {
      updates.push("icon = ?");
      args.push(body.icon || null);
    }

    if (body.priority !== undefined) {
      updates.push("priority = ?");
      args.push(body.priority);
    }

    if (body.parentId !== undefined) {
      if (body.parentId !== null) {
        const parentProject = await queryOne<Project>(
          "SELECT id FROM projects WHERE id = ? AND user_id = ?",
          [body.parentId, access!.project.user_id]
        );
        if (!parentProject) {
          return NextResponse.json({ error: "Parent project not found" }, { status: 400 });
        }
        if (body.parentId === id) {
          return NextResponse.json({ error: "Cannot set project as its own parent" }, { status: 400 });
        }
      }
      updates.push("parent_id = ?");
      args.push(body.parentId);
    }

    if (updates.length === 0) {
      return NextResponse.json({ project: access!.project });
    }

    updates.push("updated_at = CURRENT_TIMESTAMP");
    args.push(id);

    await db.execute({
      sql: `UPDATE projects SET ${updates.join(", ")} WHERE id = ?`,
      args,
    });

    const project = await queryOne<Project>(
      "SELECT * FROM projects WHERE id = ?",
      [id]
    );

    return NextResponse.json({ project });
  } catch (error) {
    console.error("[API] PUT /api/projects/[id] failed:", error);
    return NextResponse.json({ error: "Failed to update project" }, { status: 500 });
  }
}

// DELETE /api/projects/[id] - Delete a project (owner only)
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const access = await getProjectAccess(id, user.id);

    if (!isOwner(access)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await db.execute({
      sql: "UPDATE projects SET parent_id = ? WHERE parent_id = ? AND user_id = ?",
      args: [access!.project.parent_id || null, id, user.id],
    });

    await db.execute({
      sql: "UPDATE notes SET project_id = NULL WHERE project_id = ?",
      args: [id],
    });

    await db.execute({
      sql: "UPDATE tasks SET project_id = NULL WHERE project_id = ?",
      args: [id],
    });

    await db.execute({
      sql: "DELETE FROM projects WHERE id = ? AND user_id = ?",
      args: [id, user.id],
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[API] DELETE /api/projects/[id] failed:", error);
    return NextResponse.json({ error: "Failed to delete project" }, { status: 500 });
  }
}
