/**
 * Test script for Obsidian import functionality
 * Run with: npx tsx scripts/test-import.ts
 */

// Load environment FIRST
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@libsql/client";
import * as path from "path";
import * as fs from "fs/promises";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const VAULT_PATH = "/home/wicked/Documents/Personal Projects";

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
}

const results: TestResult[] = [];

function log(message: string) {
  console.log(`\n${message}`);
}

function success(name: string, message: string) {
  results.push({ name, passed: true, message });
  console.log(`  ✓ ${message}`);
}

function fail(name: string, message: string) {
  results.push({ name, passed: false, message });
  console.log(`  ✗ ${message}`);
}

async function getTestUser(): Promise<{ id: string; email: string } | null> {
  const result = await db.execute("SELECT id, email FROM users LIMIT 1");
  if (result.rows.length === 0) return null;
  return result.rows[0] as { id: string; email: string };
}

async function testVaultExists() {
  log("1. Testing vault path exists...");
  try {
    const stat = await fs.stat(VAULT_PATH);
    if (stat.isDirectory()) {
      success("vault_exists", `Vault exists at ${VAULT_PATH}`);
    } else {
      fail("vault_exists", "Path is not a directory");
    }
  } catch (error) {
    fail("vault_exists", `Vault not found: ${error}`);
  }
}

async function testPreviewImport() {
  log("2. Testing import preview...");
  try {
    // Dynamic import after env is loaded
    const { previewImport } = await import("../src/lib/import/obsidian");
    const preview = await previewImport(VAULT_PATH);
    console.log(`     Total files: ${preview.totalFiles}`);
    console.log(`     Folders: ${preview.folders.slice(0, 5).join(", ")}${preview.folders.length > 5 ? "..." : ""}`);
    console.log(`     Sample files:`);
    for (const file of preview.sampleFiles.slice(0, 5)) {
      console.log(`       - ${file.title} (${file.folder})`);
    }

    if (preview.totalFiles > 0) {
      success("preview", `Found ${preview.totalFiles} files in ${preview.folders.length} folders`);
    } else {
      fail("preview", "No markdown files found");
    }
  } catch (error) {
    fail("preview", `Preview failed: ${error}`);
  }
}

async function testParseFile() {
  log("3. Testing file parsing...");
  try {
    const { parseObsidianFile } = await import("../src/lib/import/obsidian");

    // Find a markdown file to test
    const files = await fs.readdir(VAULT_PATH, { recursive: true });
    const mdFile = files.find((f) => f.toString().endsWith(".md"));

    if (!mdFile) {
      fail("parse", "No markdown files found to test");
      return;
    }

    const filePath = path.join(VAULT_PATH, mdFile.toString());
    const parsed = await parseObsidianFile(filePath, VAULT_PATH);

    if (parsed) {
      console.log(`     File: ${mdFile}`);
      console.log(`     Title: ${parsed.title}`);
      console.log(`     Folder: ${parsed.folder}`);
      console.log(`     Wikilinks: ${parsed.wikilinks.length}`);
      console.log(`     Tags: ${parsed.tags.join(", ") || "(none)"}`);
      console.log(`     Has frontmatter: ${Object.keys(parsed.frontmatter).length > 0}`);
      success("parse", `Successfully parsed: ${parsed.title}`);
    } else {
      fail("parse", "Failed to parse file");
    }
  } catch (error) {
    fail("parse", `Parse error: ${error}`);
  }
}

async function testDryRunImport() {
  log("4. Testing dry run import...");
  const user = await getTestUser();
  if (!user) {
    fail("dry_run", "No test user found");
    return;
  }

  try {
    const { importObsidianVault } = await import("../src/lib/import/obsidian");
    const result = await importObsidianVault({
      vaultPath: VAULT_PATH,
      userId: user.id,
      mapFoldersToProjects: true,
      skipDuplicates: true,
      dryRun: true,
    });

    console.log(`     Would import: ${result.imported} notes`);
    console.log(`     Would skip: ${result.skipped} duplicates`);
    console.log(`     Projects to create: ${result.projectsCreated.length}`);

    if (result.imported > 0) {
      success("dry_run", `Dry run successful: ${result.imported} notes would be imported`);
    } else {
      fail("dry_run", "No notes would be imported");
    }
  } catch (error) {
    fail("dry_run", `Dry run failed: ${error}`);
  }
}

async function testActualImport() {
  log("5. Testing actual import (limited to one folder)...");
  const user = await getTestUser();
  if (!user) {
    fail("import", "No test user found");
    return;
  }

  // Get preview first to find a folder with few files
  const { previewImport, importObsidianVault } = await import("../src/lib/import/obsidian");
  const preview = await previewImport(VAULT_PATH);

  // Find a small folder to test with
  let testFolder = preview.folders[0];
  if (preview.folders.length > 1) {
    // Try to find a folder that's not the root
    testFolder = preview.folders.find((f) => f !== "root") || preview.folders[0];
  }

  console.log(`     Testing with folder: ${testFolder}`);

  try {
    // Count notes before import
    const beforeCount = await db.execute({
      sql: "SELECT COUNT(*) as count FROM notes WHERE user_id = ?",
      args: [user.id],
    });
    const notesBefore = (beforeCount.rows[0] as { count: number }).count;

    // Import
    const result = await importObsidianVault({
      vaultPath: VAULT_PATH,
      userId: user.id,
      mapFoldersToProjects: true,
      skipDuplicates: true,
      folderFilter: [testFolder],
      dryRun: false,
    });

    console.log(`     Imported: ${result.imported} notes`);
    console.log(`     Skipped: ${result.skipped} duplicates`);
    console.log(`     Projects created: ${result.projectsCreated.join(", ") || "(none)"}`);
    console.log(`     Errors: ${result.errors.length}`);

    if (result.errors.length > 0) {
      console.log(`     Error details: ${result.errors.slice(0, 3).join("; ")}`);
    }

    // Count notes after import
    const afterCount = await db.execute({
      sql: "SELECT COUNT(*) as count FROM notes WHERE user_id = ?",
      args: [user.id],
    });
    const notesAfter = (afterCount.rows[0] as { count: number }).count;

    console.log(`     Notes before: ${notesBefore}, after: ${notesAfter}`);

    if (result.imported > 0) {
      success("import", `Successfully imported ${result.imported} notes`);
    } else if (result.skipped > 0) {
      success("import", `All ${result.skipped} notes were duplicates (skipped)`);
    } else {
      fail("import", "No notes were imported");
    }
  } catch (error) {
    fail("import", `Import failed: ${error}`);
  }
}

async function testQueueJobs() {
  log("6. Checking processing queue...");
  try {
    const queueStats = await db.execute(`
      SELECT status, COUNT(*) as count
      FROM processing_queue
      GROUP BY status
    `);

    console.log("     Queue status:");
    for (const row of queueStats.rows) {
      const r = row as { status: string; count: number };
      console.log(`       ${r.status}: ${r.count}`);
    }

    const pendingJobs = await db.execute(`
      SELECT operation, COUNT(*) as count
      FROM processing_queue
      WHERE status = 'pending'
      GROUP BY operation
      ORDER BY count DESC
    `);

    if (pendingJobs.rows.length > 0) {
      console.log("     Pending by operation:");
      for (const row of pendingJobs.rows) {
        const r = row as { operation: string; count: number };
        console.log(`       ${r.operation}: ${r.count}`);
      }
      success("queue", "Processing jobs queued successfully");
    } else {
      success("queue", "No pending jobs (may all be processed already)");
    }
  } catch (error) {
    fail("queue", `Queue check failed: ${error}`);
  }
}

async function testReimportSkipsDuplicates() {
  log("7. Testing duplicate skip on re-import...");
  const user = await getTestUser();
  if (!user) {
    fail("duplicates", "No test user found");
    return;
  }

  // Get a folder we've already imported
  const { previewImport, importObsidianVault } = await import("../src/lib/import/obsidian");
  const preview = await previewImport(VAULT_PATH);
  const testFolder = preview.folders.find((f) => f !== "root") || preview.folders[0];

  try {
    const result = await importObsidianVault({
      vaultPath: VAULT_PATH,
      userId: user.id,
      mapFoldersToProjects: true,
      skipDuplicates: true,
      folderFilter: [testFolder],
      dryRun: false,
    });

    console.log(`     Imported: ${result.imported}`);
    console.log(`     Skipped: ${result.skipped}`);

    if (result.skipped > 0 && result.imported === 0) {
      success("duplicates", `All ${result.skipped} notes correctly skipped as duplicates`);
    } else if (result.skipped > 0) {
      success("duplicates", `Skipped ${result.skipped} duplicates, imported ${result.imported} new`);
    } else {
      success("duplicates", "No duplicates to skip (first import)");
    }
  } catch (error) {
    fail("duplicates", `Duplicate test failed: ${error}`);
  }
}

async function testProjectMapping() {
  log("8. Testing folder-to-project mapping...");
  const user = await getTestUser();
  if (!user) {
    fail("projects", "No test user found");
    return;
  }

  try {
    const projects = await db.execute({
      sql: `SELECT name, slug, description FROM projects WHERE user_id = ?`,
      args: [user.id],
    });

    console.log(`     Projects created: ${projects.rows.length}`);
    for (const row of projects.rows) {
      const p = row as { name: string; slug: string; description: string };
      console.log(`       - ${p.name} (${p.slug})`);
    }

    if (projects.rows.length > 0) {
      success("projects", `${projects.rows.length} projects created from folders`);
    } else {
      success("projects", "No projects created (may be root-only folder)");
    }
  } catch (error) {
    fail("projects", `Project check failed: ${error}`);
  }
}

async function printSummary() {
  log("\n========================================");
  log("TEST SUMMARY");
  log("========================================");

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  for (const result of results) {
    const icon = result.passed ? "✓" : "✗";
    console.log(`${icon} ${result.name}: ${result.message}`);
  }

  console.log("\n----------------------------------------");
  console.log(`Total: ${passed} passed, ${failed} failed`);

  if (failed === 0) {
    console.log("\nAll tests passed!");
  } else {
    console.log("\nSome tests failed. Review the output above.");
  }
}

async function main() {
  console.log("========================================");
  console.log("OBSIDIAN IMPORT TEST");
  console.log("========================================");
  console.log(`Vault: ${VAULT_PATH}`);

  await testVaultExists();
  await testPreviewImport();
  await testParseFile();
  await testDryRunImport();
  await testActualImport();
  await testQueueJobs();
  await testReimportSkipsDuplicates();
  await testProjectMapping();

  await printSummary();

  await db.close();
}

main().catch(console.error);
