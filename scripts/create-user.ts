/**
 * Create the first (or any) user account.
 *
 * Signups are closed by default (see src/lib/auth/signup-policy.ts), which
 * means a fresh deployment has nobody who can log in. This is how the operator
 * bootstraps themselves without opening the instance to the internet.
 *
 * The account has no password — Brain Portal authenticates by magic link. This
 * script only makes the address known, so that requesting a link for it works.
 *
 * Usage:
 *   npx tsx scripts/create-user.ts <email> [name]
 *
 * Example:
 *   npx tsx scripts/create-user.ts you@example.com "Your Name"
 */

import { createClient } from "@libsql/client";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  const name = process.argv[3]?.trim();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error("Usage: npx tsx scripts/create-user.ts <email> [name]");
    process.exit(1);
  }

  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) {
    console.error("TURSO_DATABASE_URL is not set. Copy .env.example to .env.local first.");
    process.exit(1);
  }

  const db = createClient({ url, authToken });

  const existing = await db.execute({
    sql: "SELECT id, email FROM users WHERE email = ?",
    args: [email],
  });

  if (existing.rows.length > 0) {
    console.log(`User already exists: ${email}`);
    console.log("Request a sign-in link from the login page to get in.");
    return;
  }

  if (name) {
    await db.execute({
      sql: "INSERT INTO users (email, name) VALUES (?, ?)",
      args: [email, name],
    });
  } else {
    await db.execute({
      sql: "INSERT INTO users (email) VALUES (?)",
      args: [email],
    });
  }

  console.log(`Created user: ${email}`);
  console.log("");
  console.log("Next: open /auth/login, enter that address, and follow the");
  console.log("emailed link. Existing users can always sign in, whatever");
  console.log("SIGNUP_MODE is set to.");
}

main().catch((error) => {
  console.error("Failed to create user:", error);
  process.exit(1);
});
