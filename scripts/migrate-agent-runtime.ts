/**
 * Add the delegated-task lifecycle schema (the runtime layer) and bring work
 * the earlier executor left pending into it.
 *
 * `npm run db:migrate` (which runs on every build) applies the same migration;
 * this script exists to apply it, and read its report, on its own.
 *
 * Additive and idempotent. Legacy rows are examined only on the first
 * application. With `AGENT_RUNTIME=openrouter` (the default) pending work
 * keeps running as before. With `hermes` or `off`, `queued` and
 * `revision_requested` become "not sent" and wait for the user to send them,
 * and `processing` becomes "needs review" in every case.
 *
 * Run with: npm run migrate:agent-runtime
 */

import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";
import { applyAgentRuntimeMigration } from "../src/lib/agents/runtime/schema";

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

  const runtime = process.env.AGENT_RUNTIME || "openrouter";
  console.log(`Agent runtime migration (AGENT_RUNTIME=${runtime})\n`);
  const report = await applyAgentRuntimeMigration(db, { runtime, log: (m) => console.log(m) });
  if (report.legacy) {
    console.log(
      `\nLegacy pending work: ${report.legacy.toQueue} left running, ` +
        `${report.legacy.toNeedsDispatch} parked as "not sent", ` +
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
