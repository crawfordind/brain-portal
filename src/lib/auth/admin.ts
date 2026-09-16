import { getCurrentUser } from "@/lib/auth";
import type { User } from "@/lib/db/schema";

// Admin emails — set ADMIN_EMAILS env var (comma-separated) or defaults to first user
const getAdminEmails = (): string[] => {
  const env = process.env.ADMIN_EMAILS;
  return env ? env.split(",").map((e) => e.trim().toLowerCase()) : [];
};

export function isAdmin(user: User): boolean {
  const admins = getAdminEmails();
  // Require explicit ADMIN_EMAILS configuration — no implicit admin access
  if (admins.length === 0) {
    console.warn("[AUTH] ADMIN_EMAILS not configured. No admin access granted.");
    return false;
  }
  return admins.includes(user.email.toLowerCase());
}

export async function requireAdmin(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (!isAdmin(user)) throw new Error("Forbidden");
  return user;
}
