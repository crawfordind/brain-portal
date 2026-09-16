import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function testAgentStructure() {
  console.log("=== Testing AI Agent Delegation System Structure ===\n");

  // Check if agent_configs table exists and has agents
  console.log("1. Checking agent configurations...");
  const agentsResult = await db.execute("SELECT agent_type, display_name, icon FROM agent_configs WHERE is_active = TRUE");
  console.log(`   ✓ Found ${agentsResult.rows.length} active agents:`);
  agentsResult.rows.forEach((row) => {
    console.log(`     ${row.icon} ${row.display_name} (${row.agent_type})`);
  });

  // Check if we can create a test task
  console.log("\n2. Creating test task...");
  const userResult = await db.execute("SELECT id FROM users LIMIT 1");
  if (!userResult.rows.length) {
    console.log("   ✗ No users found. Create a user account first.");
    return;
  }
  const userId = userResult.rows[0].id as string;

  await db.execute({
    sql: `
      INSERT INTO agent_tasks
      (user_id, title, description, task_type, assigned_agent, priority, output_format, context_note_ids, context_urls)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      userId,
      "Test Task - Write a haiku",
      "Write a simple haiku about coding",
      "copy",
      "copy",
      "medium",
      "plain_text",
      "[]",
      "[]",
    ],
  });
  console.log("   ✓ Test task created successfully");

  // Get the task details
  const taskResult = await db.execute(
    "SELECT id, title, status, assigned_agent FROM agent_tasks WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
    [userId]
  );
  const task = taskResult.rows[0];
  console.log(`   ✓ Task ID: ${task.id}`);
  console.log(`   ✓ Status: ${task.status}`);
  console.log(`   ✓ Assigned to: ${task.assigned_agent}`);

  // Check API key configuration
  console.log("\n3. Checking API configuration...");
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey || apiKey === "your-openrouter-api-key") {
    console.log("   ⚠ OPENROUTER_API_KEY not configured");
    console.log("   → To test LLM execution, add your OpenRouter API key to .env.local:");
    console.log("   → OPENROUTER_API_KEY=sk-or-v1-...");
    console.log("   → Get a key at: https://openrouter.ai/keys");
  } else {
    console.log(`   ✓ API key configured (${apiKey.substring(0, 10)}...)`);
  }

  console.log("\n=== System Structure Test Complete ===");
  console.log("\n📊 Summary:");
  console.log(`   ✓ Database tables created`);
  console.log(`   ✓ ${agentsResult.rows.length} AI agents configured`);
  console.log(`   ✓ Task creation working`);
  console.log(`   ${!apiKey || apiKey === "your-openrouter-api-key" ? "⚠" : "✓"} API key ${!apiKey || apiKey === "your-openrouter-api-key" ? "needs setup" : "configured"}`);
}

testAgentStructure().catch(console.error);
