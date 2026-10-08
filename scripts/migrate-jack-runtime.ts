/**
 * Add the Jack task-runtime schema and park work the retired OpenRouter
 * runtime left pending.
 *
 * `npm run db:migrate` (which runs on every build) applies the same migration;
 * this script exists to apply it, and read its report, on its own.
 *
 * Additive and idempotent. Legacy rows are examined only on the first
 * application: `queued` / `revision_requested` become "not sent", `processing`
 * becomes "needs review". Nothing is sent to Jack; Daniel sends parked work
 * explicitly from the review screen.
 *
 * Run with: npm run migrate:jack-runtime
 */

import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";
import { applyJackRuntimeMigration } from "../src/lib/agents/jack/schema";

dotenv.config({ path: ".env.local" });

async function main() {
  if (!process.env.TURSO_DATABASE_URL) {
    console.error("Error: TURSO_DATABASE_URL is not defined");
    process.exit(1);
  }
  const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  console.log("Jack task runtime migration\n");
  const report = await applyJackRuntimeMigration(db, (m) => console.log(m));
  if (report.legacy) {
    console.log(
      `\nLegacy pending work: ${report.legacy.toNeedsDispatch} parked as "not sent", ` +
        `${report.legacy.toNeedsReview} flagged "needs review".`
    );
  } else {
    console.log("\nAlready applied; legacy rows were handled on the first run.");
  }
  db.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
