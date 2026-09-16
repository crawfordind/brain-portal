import { queryOne } from "@/lib/db/client";
import type { Project, ProjectCollaborator } from "@/lib/db/schema";

export type ProjectRole = 'owner' | 'editor' | 'viewer';

export interface ProjectAccess {
  project: Project;
  role: ProjectRole;
}

const ROLE_LEVEL: Record<ProjectRole, number> = {
  owner: 3,
  editor: 2,
  viewer: 1,
};

/**
 * Check if a user has access to a project (by project ID).
 * Returns the project and the user's role, or null if no access.
 */
export async function getProjectAccess(
  projectId: string,
  userId: string
): Promise<ProjectAccess | null> {
  // Check if owner
  const ownedProject = await queryOne<Project>(
    "SELECT * FROM projects WHERE id = ? AND user_id = ?",
    [projectId, userId]
  );

  if (ownedProject) {
    return { project: ownedProject, role: "owner" };
  }

  // Check collaborator access
  const collab = await queryOne<ProjectCollaborator>(
    `SELECT * FROM project_collaborators
     WHERE project_id = ? AND user_id = ? AND status = 'accepted'`,
    [projectId, userId]
  );

  if (collab) {
    const project = await queryOne<Project>(
      "SELECT * FROM projects WHERE id = ?",
      [projectId]
    );
    if (project) {
      return { project, role: collab.role };
    }
  }

  return null;
}

/**
 * Check if a user has access to a project (by slug).
 * Resolves the slug to a project ID first.
 */
export async function getProjectAccessBySlug(
  slug: string,
  userId: string
): Promise<ProjectAccess | null> {
  // Try owned project first
  const ownedProject = await queryOne<Project>(
    "SELECT * FROM projects WHERE slug = ? AND user_id = ?",
    [slug, userId]
  );

  if (ownedProject) {
    return { project: ownedProject, role: "owner" };
  }

  // Check shared projects by slug
  const sharedProject = await queryOne<Project & { collab_role: ProjectRole }>(
    `SELECT p.*, pc.role as collab_role
     FROM projects p
     JOIN project_collaborators pc ON pc.project_id = p.id
     WHERE p.slug = ? AND pc.user_id = ? AND pc.status = 'accepted'`,
    [slug, userId]
  );

  if (sharedProject) {
    return { project: sharedProject, role: sharedProject.collab_role };
  }

  return null;
}

/** True for owner and editor roles */
export function canEdit(access: ProjectAccess | null): boolean {
  return !!access && ROLE_LEVEL[access.role] >= ROLE_LEVEL.editor;
}

/** True only for the project owner */
export function isOwner(access: ProjectAccess | null): boolean {
  return !!access && access.role === "owner";
}
