/**
 * Generate an MCP API Key
 *
 * Creates a new API key for MCP server authentication.
 * The plaintext key is shown ONCE - save it immediately.
 *
 * Usage:
 *   npx tsx scripts/generate-mcp-key.ts <user_email> [key_name]
 *
 * Example:
 *   npx tsx scripts/generate-mcp-key.ts user@example.com "Claude Code"
 */

import { createClient } from "@libsql/client";
import { createHash, randomBytes } from "crypto";
import dotenv from "dotenv";

dotenv.config();

async function main() {
  const email = process.argv[2];
  const keyName = process.argv[3] || "MCP API Key";

  if (!email) {
    console.error("Usage: npx tsx scripts/generate-mcp-key.ts <user_email> [key_name]");
    process.exit(1);
  }

  const db = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  // Find user
  const result = await db.execute({
    sql: "SELECT id, email, display_name FROM users WHERE email = ?",
    args: [email],
  });

  if (result.rows.length === 0) {
    console.error(`No user found with email: ${email}`);
    process.exit(1);
  }

  const user = result.rows[0];
  console.log(`Found user: ${user.display_name || user.email} (${user.id})`);

  // Generate key
  const rawKey = `bp_mcp_${randomBytes(32).toString("hex")}`;
  const keyHash = createHash("sha256").update(rawKey).digest("hex");
  const keyPrefix = rawKey.substring(0, 12);

  await db.execute({
    sql: `INSERT INTO mcp_api_keys (user_id, name, key_hash, key_prefix, scopes)
          VALUES (?, ?, ?, ?, '["*"]')`,
    args: [user.id as string, keyName, keyHash, keyPrefix],
  });

  console.log("\n========================================");
  console.log("  MCP API Key Generated Successfully");
  console.log("========================================");
  console.log(`  Name:   ${keyName}`);
  console.log(`  User:   ${user.email}`);
  console.log(`  Prefix: ${keyPrefix}`);
  console.log(`\n  API Key (save this - shown only once):`);
  console.log(`  ${rawKey}`);
  console.log("\n========================================");
  console.log("\nAdd to your Claude Code config:");
  console.log(`  "env": { "MCP_API_KEY": "${rawKey}" }`);
}

main().catch(console.error);
