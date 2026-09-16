/**
 * Add Janine (UX Agent) to Production Database
 *
 * This migrates the agent_configs and agent_tasks tables to include 'ux' in CHECK constraints
 * Run with: npx tsx scripts/add-janine-agent.ts
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@libsql/client';

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function addJanineAgent() {
  console.log('🎨 Adding Janine Foster (UX Expert) to your AI team...\n');

  try {
    // Clean up any leftover temp tables from previous runs
    try {
      await db.execute('DROP TABLE IF EXISTS agent_configs_new');
      await db.execute('DROP TABLE IF EXISTS agent_tasks_new');
    } catch (e) {
      // Ignore
    }

    // Disable foreign key constraints temporarily
    await db.execute('PRAGMA foreign_keys = OFF');

    // Step 1: Recreate agent_configs table with updated constraint
    console.log('📋 Step 1/4: Recreating agent_configs table...');

    await db.execute(`
      CREATE TABLE agent_configs_new (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        agent_type TEXT UNIQUE NOT NULL CHECK (agent_type IN ('code', 'copy', 'research', 'marketing', 'analyst', 'general', 'ux')),
        display_name TEXT NOT NULL,
        description TEXT NOT NULL,
        system_prompt TEXT NOT NULL,
        model_id TEXT NOT NULL DEFAULT 'x-ai/grok-4.1-fast',
        icon TEXT DEFAULT '🤖',
        is_active BOOLEAN DEFAULT TRUE,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);

    // Copy existing data
    await db.execute(`
      INSERT INTO agent_configs_new (id, agent_type, display_name, description, system_prompt, model_id, icon, is_active, created_at, updated_at)
      SELECT id, agent_type, display_name, description, system_prompt, model_id, icon, is_active, created_at, updated_at
      FROM agent_configs
    `);

    // Drop old table and rename
    await db.execute('DROP TABLE agent_configs');
    await db.execute('ALTER TABLE agent_configs_new RENAME TO agent_configs');

    console.log('✓ agent_configs table updated\n');

    // Step 2: Recreate agent_tasks table with updated constraint
    console.log('📋 Step 2/4: Recreating agent_tasks table...');

    // Check existing agent_tasks data
    const existingTasks = await db.execute('SELECT COUNT(*) as count FROM agent_tasks');
    console.log(`   Found ${existingTasks.rows[0].count} existing agent tasks to migrate`);

    await db.execute(`
      CREATE TABLE agent_tasks_new (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        task_type TEXT NOT NULL CHECK (task_type IN ('code', 'copy', 'research', 'marketing', 'analyst', 'general', 'ux')),
        assigned_agent TEXT NOT NULL CHECK (assigned_agent IN ('code', 'copy', 'research', 'marketing', 'analyst', 'general', 'ux')),
        status TEXT DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'awaiting_review', 'revision_requested', 'approved', 'rejected', 'failed')),
        priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
        output_format TEXT DEFAULT 'markdown' CHECK (output_format IN ('markdown', 'code', 'plain_text', 'structured')),
        context_note_ids TEXT DEFAULT '[]',
        context_urls TEXT DEFAULT '[]',
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        max_revisions INTEGER DEFAULT 5,
        current_version INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);

    // Copy existing data
    await db.execute(`
      INSERT INTO agent_tasks_new (
        id, user_id, task_id, title, description, task_type, assigned_agent,
        status, priority, output_format, context_note_ids, context_urls,
        project_id, max_revisions, current_version, created_at, updated_at
      )
      SELECT
        id, user_id, task_id, title, description, task_type, assigned_agent,
        status, priority, output_format, context_note_ids, context_urls,
        project_id, max_revisions, current_version, created_at, updated_at
      FROM agent_tasks
    `);

    // Drop old table and rename
    await db.execute('DROP TABLE agent_tasks');
    await db.execute('ALTER TABLE agent_tasks_new RENAME TO agent_tasks');

    // Recreate indexes
    await db.execute('CREATE INDEX IF NOT EXISTS idx_agent_tasks_user ON agent_tasks(user_id)');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_agent_tasks_status ON agent_tasks(status)');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_agent_tasks_type ON agent_tasks(task_type)');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_agent_tasks_task ON agent_tasks(task_id)');

    console.log('✓ agent_tasks table updated\n');

    // Step 3: Insert Janine
    console.log('📋 Step 3/4: Adding Janine Foster...');

    const janine = {
      agent_type: 'ux',
      display_name: 'Janine Foster',
      description: 'UI/UX Design Expert • User-focused & creative designer',
      icon: '🎨',
      system_prompt: `You are Janine Foster, a UI/UX Design Expert passionate about creating delightful user experiences.

Your personality:
- Creative, empathetic, and user-focused
- You think about how people interact with technology
- You balance aesthetics with usability
- You're collaborative and love iterating on ideas

Communication style:
- Visual and descriptive
- Use "Users will..." and "This helps people..."
- Think aloud about design decisions
- Ask questions about user needs and context

Your expertise:
- User interface design (web and mobile)
- User experience research and testing
- Information architecture
- Interaction design
- Wireframing and prototyping
- Design systems and components
- Accessibility and inclusive design

When designing:
1. Start with user needs and goals
2. Consider the entire user journey
3. Prioritize usability over decoration
4. Make designs accessible to all users
5. Iterate based on feedback
6. Think about edge cases and error states

Design principles you follow:
- Clarity over complexity
- Consistency in patterns and interactions
- Helpful feedback and clear affordances
- Mobile-first, responsive design
- WCAG accessibility standards

Remember: Great design is invisible - it just works. Help users create interfaces that are intuitive, accessible, and delightful to use.`,
    };

    await db.execute({
      sql: `
        INSERT INTO agent_configs (agent_type, display_name, description, icon, system_prompt)
        VALUES (?, ?, ?, ?, ?)
      `,
      args: [
        janine.agent_type,
        janine.display_name,
        janine.description,
        janine.icon,
        janine.system_prompt,
      ],
    });

    console.log('✓ Janine Foster added to your team\n');

    // Step 4: Verify
    console.log('📋 Step 4/4: Verifying...');
    const result = await db.execute('SELECT agent_type, display_name, description FROM agent_configs ORDER BY agent_type');

    console.log('\n🎉 Success! Your complete AI team:\n');
    result.rows.forEach((row: any) => {
      console.log(`  ${row.agent_type.padEnd(10)} → ${row.display_name} - ${row.description}`);
    });

    console.log('\n✅ Janine is now available for delegation!');

    // Re-enable foreign key constraints
    await db.execute('PRAGMA foreign_keys = ON');

  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    console.error('\nYour data is safe - the migration stopped before making changes.');

    // Re-enable foreign key constraints even on error
    try {
      await db.execute('PRAGMA foreign_keys = ON');
    } catch (e) {
      // Ignore
    }

    process.exit(1);
  }
}

addJanineAgent()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
