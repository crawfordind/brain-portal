#!/usr/bin/env tsx
/**
 * Test the /api/graph endpoint to ensure it returns connections
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function main() {
  console.log('🧪 TESTING GRAPH API LOGIC\n');

  // Get a user ID
  const userResult = await db.execute({
    sql: 'SELECT id FROM users LIMIT 1',
    args: []
  });

  if (userResult.rows.length === 0) {
    console.log('❌ No users found');
    process.exit(1);
  }

  const userId = (userResult.rows[0] as { id: string }).id;
  console.log(`👤 Testing with user: ${userId}\n`);

  const limit = 200;

  // Simulate the graph API query for nodes
  const nodesQuery = `
    SELECT
      n.id,
      n.title,
      n.slug,
      n.is_pinned as isPinned,
      n.word_count as wordCount,
      n.project_id as projectId,
      p.name as projectName,
      COALESCE(p.color, '#6b7280') as projectColor,
      (
        SELECT COUNT(DISTINCT nc.id)
        FROM note_connections nc
        WHERE (nc.source_note_id = n.id OR nc.target_note_id = n.id)
          AND nc.user_id = ?
      ) as connectionCount
    FROM notes n
    LEFT JOIN projects p ON n.project_id = p.id
    WHERE n.user_id = ?
      AND n.is_archived = 0
    ORDER BY connectionCount DESC, n.updated_at DESC
    LIMIT ?
  `;

  const nodesResult = await db.execute({
    sql: nodesQuery,
    args: [userId, userId, limit]
  });

  const nodes = nodesResult.rows;
  console.log(`📊 Found ${nodes.length} nodes\n`);

  // Show top 10 nodes by connection count
  console.log('Top 10 nodes by connections:\n');
  for (const node of nodes.slice(0, 10) as any[]) {
    console.log(`  ${String(node.connectionCount).padStart(3)} connections - ${node.title.substring(0, 50)}`);
  }
  console.log();

  if (nodes.length === 0) {
    console.log('❌ No nodes returned. Graph would be empty.\n');
    await db.close();
    process.exit(1);
  }

  // Get note IDs
  const noteIds = nodes.map((n: any) => n.id);
  const placeholders = noteIds.map(() => '?').join(',');

  // Simulate the graph API query for links
  const linksQuery = `
    SELECT
      nc.source_note_id as source,
      nc.target_note_id as target,
      nc.connection_type as type,
      nc.strength,
      nc.is_manual as isManual,
      nc.reason
    FROM note_connections nc
    WHERE nc.user_id = ?
      AND nc.source_note_id IN (${placeholders})
      AND nc.target_note_id IN (${placeholders})
  `;

  const linksResult = await db.execute({
    sql: linksQuery,
    args: [userId, ...noteIds, ...noteIds]
  });

  const links = linksResult.rows;
  console.log(`🔗 Found ${links.length} links between these nodes\n`);

  if (links.length === 0) {
    console.log('⚠️  NO LINKS FOUND!');
    console.log('   The graph would show nodes but no connections.\n');

    // Debug: Check if connections exist at all
    const allConnectionsResult = await db.execute({
      sql: 'SELECT COUNT(*) as count FROM note_connections WHERE user_id = ?',
      args: [userId]
    });
    const allConnectionsCount = (allConnectionsResult.rows[0] as { count: number }).count;
    console.log(`   Total connections for this user: ${allConnectionsCount}`);

    if (allConnectionsCount > 0) {
      console.log(`   Problem: Connections exist but aren't in the result set.`);
      console.log(`   Possible cause: Connections are between notes not in the top ${limit} by connectionCount.\n`);

      // Sample some connections
      const sampleResult = await db.execute({
        sql: `
          SELECT nc.*, sn.title as source_title, tn.title as target_title
          FROM note_connections nc
          JOIN notes sn ON nc.source_note_id = sn.id
          JOIN notes tn ON nc.target_note_id = tn.id
          WHERE nc.user_id = ?
          LIMIT 5
        `,
        args: [userId]
      });

      console.log('   Sample connections:');
      for (const conn of sampleResult.rows as any[]) {
        console.log(`     ${conn.source_title.substring(0, 30)} → ${conn.target_title.substring(0, 30)}`);
      }
    }
  } else {
    console.log('✅ Graph API would return:');
    console.log(`   - ${nodes.length} nodes`);
    console.log(`   - ${links.length} links\n`);

    // Sample some links
    console.log('Sample links:\n');
    for (const link of links.slice(0, 10) as any[]) {
      const source = nodes.find((n: any) => n.id === link.source);
      const target = nodes.find((n: any) => n.id === link.target);
      console.log(`  ${(source as any)?.title?.substring(0, 25)} → ${(target as any)?.title?.substring(0, 25)} (strength: ${link.strength})`);
    }
  }

  await db.close();
}

main().catch(console.error);
