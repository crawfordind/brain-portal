/**
 * Create the `note_shares` table (account-to-account note sharing).
 *
 * Also run by `npm run db:migrate`, which runs on every build; this script is
 * for applying it on its own. Idempotent.
 */
import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";
import { applyNoteSharingMigration } from "../src/lib/sharing/schema";

dotenv.config({ path: ".env.local" });

async function main() {
  if (!process.env.TURSO_DATABASE_URL) {
    console.error("TURSO_DATABASE_URL is not set");
    process.exit(1);
  }
  const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  await applyNoteSharingMigration(db, (m) => console.log(m));
  console.log("Note sharing migration complete.");
  db.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
