import { randomBytes, createHash } from "crypto";
import { db, queryOne, queryAll } from "@/lib/db/client";
import { sendEmail, isEmailConfigured } from "@/lib/email/index";
import { createMagicLink } from "@/lib/auth/index";
import type { ProjectCollaborator, User, Project } from "@/lib/db/schema";

const INVITE_EXPIRY_DAYS = 7;

function generateToken(): string {
  return randomBytes(32).toString("hex");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Create or resend a project invite.
 */
export async function createProjectInvite(
  projectId: string,
  email: string,
  role: "editor" | "viewer",
  invitedBy: string
): Promise<{ inviteToken: string; isResend: boolean }> {
  const normalizedEmail = email.toLowerCase().trim();

  // Check for existing collaborator
  const existing = await queryOne<ProjectCollaborator>(
    "SELECT * FROM project_collaborators WHERE project_id = ? AND email = ?",
    [projectId, normalizedEmail]
  );

  if (existing && existing.status === "accepted") {
    throw new Error("This person is already a collaborator on this project");
  }

  const inviteToken = generateToken();
  const hashedToken = hashToken(inviteToken);
  const expiresAt = new Date(
    Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  // Check if email matches an existing user
  const existingUser = await queryOne<User>(
    "SELECT id FROM users WHERE email = ?",
    [normalizedEmail]
  );

  if (existing && existing.status === "pending") {
    // Resend: update token and expiry
    await db.execute({
      sql: `UPDATE project_collaborators
            SET invite_token = ?, invite_expires_at = ?, role = ?,
                user_id = COALESCE(user_id, ?), updated_at = datetime('now')
            WHERE id = ?`,
      args: [
        hashedToken,
        expiresAt,
        role,
        existingUser?.id ?? null,
        existing.id,
      ],
    });
    return { inviteToken, isResend: true };
  }

  // New invite
  await db.execute({
    sql: `INSERT INTO project_collaborators
          (project_id, user_id, email, role, status, invited_by, invite_token, invite_expires_at)
          VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`,
    args: [
      projectId,
      existingUser?.id ?? null,
      normalizedEmail,
      role,
      invitedBy,
      hashedToken,
      expiresAt,
    ],
  });

  return { inviteToken, isResend: false };
}

/**
 * Accept a project invite using the raw (unhashed) token.
 * Returns the project slug for redirect, or null if invalid.
 */
export async function acceptProjectInvite(
  inviteToken: string,
  userId: string
): Promise<{ projectSlug: string } | null> {
  const hashedToken = hashToken(inviteToken);

  const collab = await queryOne<ProjectCollaborator>(
    `SELECT * FROM project_collaborators
     WHERE invite_token = ? AND status = 'pending'
       AND invite_expires_at > datetime('now')`,
    [hashedToken]
  );

  if (!collab) {
    return null;
  }

  // Accept the invite
  await db.execute({
    sql: `UPDATE project_collaborators
          SET user_id = ?, status = 'accepted', accepted_at = datetime('now'),
              invite_token = NULL, updated_at = datetime('now')
          WHERE id = ?`,
    args: [userId, collab.id],
  });

  const project = await queryOne<Project>(
    "SELECT slug FROM projects WHERE id = ?",
    [collab.project_id]
  );

  return project ? { projectSlug: project.slug } : null;
}

/**
 * List collaborators for a project with user display names.
 */
export async function getProjectCollaborators(
  projectId: string
): Promise<
  (ProjectCollaborator & { display_name: string | null })[]
> {
  return queryAll<ProjectCollaborator & { display_name: string | null }>(
    `SELECT pc.*, u.display_name
     FROM project_collaborators pc
     LEFT JOIN users u ON pc.user_id = u.id
     WHERE pc.project_id = ?
     ORDER BY pc.status ASC, pc.created_at ASC`,
    [projectId]
  );
}

/**
 * Update a collaborator's role.
 */
export async function updateCollaboratorRole(
  collaboratorId: string,
  projectId: string,
  newRole: "editor" | "viewer"
): Promise<void> {
  await db.execute({
    sql: `UPDATE project_collaborators
          SET role = ?, updated_at = datetime('now')
          WHERE id = ? AND project_id = ?`,
    args: [newRole, collaboratorId, projectId],
  });
}

/**
 * Remove a collaborator or revoke a pending invite.
 */
export async function removeCollaborator(
  collaboratorId: string,
  projectId: string
): Promise<void> {
  await db.execute({
    sql: "DELETE FROM project_collaborators WHERE id = ? AND project_id = ?",
    args: [collaboratorId, projectId],
  });
}

/**
 * Send a branded invite email.
 */
export async function sendInviteEmail(
  email: string,
  projectName: string,
  inviterName: string,
  magicLinkUrl: string
): Promise<boolean> {
  if (!isEmailConfigured()) {
    console.warn("[COLLAB] Email not configured, skipping invite email");
    return false;
  }

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 20px;">
      <h2 style="color: #1a1a2e; margin-bottom: 8px;">You're invited to collaborate</h2>
      <p style="color: #555; font-size: 15px; line-height: 1.6;">
        <strong>${inviterName}</strong> has invited you to collaborate on the project
        <strong>${projectName}</strong>.
      </p>
      <div style="margin: 28px 0;">
        <a href="${magicLinkUrl}"
           style="display: inline-block; background: #0d9488; color: #fff; padding: 12px 28px;
                  border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px;">
          Accept Invitation
        </a>
      </div>
      <p style="color: #888; font-size: 13px; line-height: 1.5;">
        This invitation expires in 7 days. If you didn't expect this email, you can safely ignore it.
      </p>
    </div>
  `;

  return sendEmail({
    to: email,
    subject: `${inviterName} invited you to "${projectName}"`,
    html,
    text: `${inviterName} invited you to collaborate on "${projectName}". Accept the invitation: ${magicLinkUrl}`,
  });
}
