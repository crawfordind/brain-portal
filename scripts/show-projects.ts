import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

interface ProjectRow {
  id: string;
  name: string;
  parent_id: string | null;
}

async function main() {
  const user = await db.execute("SELECT id FROM users LIMIT 1");
  const userId = user.rows[0].id as string;

  const projects = await db.execute({
    sql: `SELECT id, name, parent_id FROM projects WHERE user_id = ? ORDER BY name`,
    args: [userId],
  });

  console.log("PROJECT HIERARCHY:");
  console.log("==================\n");

  function printTree(parentId: string | null, indent: string) {
    for (const row of projects.rows) {
      const p = row as ProjectRow;
      if (p.parent_id === parentId) {
        console.log(indent + "- " + p.name);
        printTree(p.id, indent + "  ");
      }
    }
  }

  printTree(null, "");

  console.log("\nTotal projects:", projects.rows.length);

  await db.close();
}

main().catch(console.error);
