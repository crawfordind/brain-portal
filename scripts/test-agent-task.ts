import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@libsql/client";
import { executeAgentTask } from "@/lib/agents/executor";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function testAgentTask() {
  console.log("Creating demo agent task...\n");

  // Get a user ID (use first user in database)
  const userResult = await db.execute("SELECT id FROM users LIMIT 1");
  if (!userResult.rows.length) {
    console.error("No users found. Please create a user first.");
    return;
  }
  const userId = userResult.rows[0].id as string;
  console.log(`Using user ID: ${userId}`);

  // Create a simple task for the Writer agent
  const taskResult = await db.execute({
    sql: `
      INSERT INTO agent_tasks
      (user_id, title, description, task_type, assigned_agent, priority, output_format, context_note_ids, context_urls)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      userId,
      "Write a haiku about coding",
      "Write a simple haiku (3 lines: 5-7-5 syllables) about the joy of coding. Keep it lighthearted and fun!",
      "copy",
      "copy",
      "medium",
      "plain_text",
      "[]",
      "[]",
    ],
  });

  console.log("✓ Task created");

  // Get the task ID
  const taskQuery = await db.execute(
    "SELECT id FROM agent_tasks WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
    [userId]
  );
  const taskId = taskQuery.rows[0].id as string;
  console.log(`✓ Task ID: ${taskId}\n`);

  // Execute the task
  console.log("Executing agent task...");
  console.log("This may take 10-30 seconds depending on LLM response time.\n");

  try {
    await executeAgentTask(taskId);
    console.log("✓ Task executed successfully!\n");

    // Fetch the output
    const outputQuery = await db.execute(
      "SELECT * FROM agent_task_outputs WHERE agent_task_id = ? ORDER BY version_number DESC LIMIT 1",
      [taskId]
    );

    if (outputQuery.rows.length > 0) {
      const output = outputQuery.rows[0];
      console.log("=== AGENT OUTPUT ===");
      console.log(output.content);
      console.log("\n=== METADATA ===");
      console.log(`Model: ${output.model_used}`);
      console.log(`Tokens In: ${output.tokens_input}`);
      console.log(`Tokens Out: ${output.tokens_output}`);
      console.log(`Processing Time: ${output.processing_time_ms}ms`);
    }

    // Check task status
    const taskStatusQuery = await db.execute(
      "SELECT status, current_version FROM agent_tasks WHERE id = ?",
      [taskId]
    );
    console.log(`\nTask Status: ${taskStatusQuery.rows[0].status}`);
    console.log(`Current Version: ${taskStatusQuery.rows[0].current_version}`);
  } catch (error) {
    console.error("✗ Error executing task:", error);
  }
}

testAgentTask().catch(console.error);
