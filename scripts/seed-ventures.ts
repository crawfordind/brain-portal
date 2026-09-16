/**
 * Seed the known starting set of ventures, plus the Eden product.
 *
 * Thin CLI over `seedVentures`. The seed list and the adopt logic live in
 * src/lib/crm/seed.ts so they can be exercised by tests.
 *
 * Idempotent: re-running changes nothing.
 *
 * Run with: npx tsx scripts/seed-ventures.ts [user@example.com]
 */

import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

import { query } from "@/lib/db/client";
import { seedVentures } from "@/lib/crm/seed";

async function main() {
  if (!process.env.TURSO_DATABASE_URL) {
    console.error("Error: TURSO_DATABASE_URL is not defined");
    process.exit(1);
  }

  const email = process.argv[2];
  const users = email
    ? await query<{ id: string; email: string }>(
        `SELECT id, email FROM users WHERE email = ?`,
        [email]
      )
    : await query<{ id: string; email: string }>(`SELECT id, email FROM users`);

  if (users.length === 0) {
    console.error(
      email
        ? `No user found with email ${email}`
        : "No users found. Pass an email: npx tsx scripts/seed-ventures.ts you@example.com"
    );
    process.exit(1);
  }
  if (users.length > 1) {
    console.error(
      `Found ${users.length} users. Name one explicitly:\n` +
        users.map((u) => `  npx tsx scripts/seed-ventures.ts ${u.email}`).join("\n")
    );
    process.exit(1);
  }

  const user = users[0];
  console.log(`Seeding ventures for ${user.email}\n`);

  const report = await seedVentures(user.id);
  const width = Math.max(...report.map((r) => r.name.length));
  for (const row of report) {
    const detail =
      row.action === "adopted"
        ? `adopted (${row.mentionCount} mentions kept)`
        : "created";
    console.log(`  ${row.name.padEnd(width)}  ${row.kind.padEnd(8)}  ${detail}`);
  }

  const ventures = report.filter((r) => r.kind === "venture").length;
  const products = report.filter((r) => r.kind === "product").length;
  console.log(`\n✓ ${ventures} ventures, ${products} products.`);
  console.log("  Create anything else in the app, not in this script.");
}

main().catch((e) => {
  console.error("Seed failed:", e);
  process.exit(1);
});
