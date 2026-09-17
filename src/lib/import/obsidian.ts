/**
 * Obsidian Vault Import Module
 * Imports markdown files from an Obsidian vault into Brain Portal
 */

import * as fs from "fs/promises";
import * as path from "path";
import matter from "gray-matter";
import { db, queryOne, queryAll, mutate } from "@/lib/db/client";
import { extractWikilinks, countWords, stripMarkdown } from "@/lib/processing/local";
import { enqueue } from "@/lib/processing/queue";
import { hashContent } from "@/lib/processing/cache";
import type { Note, Project } from "@/lib/db/schema";

export interface ImportOptions {
  vaultPath: string;
  userId: string;
  mapFoldersToProjects: boolean;
  skipDuplicates: boolean;
  folderFilter?: string[];
  dryRun?: boolean;
}

export interface ImportedNote {
  id: string;
  title: string;
  folder: string;
  projectId?: string;
  projectName?: string;
}

export interface ImportResult {
  success: boolean;
  imported: number;
  skipped: number;
  errors: string[];
  projectsCreated: string[];
  notes: ImportedNote[];
}

export interface ParsedObsidianFile {
  title: string;
  content: string;
  contentWithoutFrontmatter: string;
  frontmatter: Record<string, unknown>;
  wikilinks: string[];
  tags: string[];
  folder: string;
  filePath: string;
}

/**
 * Recursively find all markdown files in a directory
 */
async function findMarkdownFiles(
  dir: string,
  baseDir: string = dir
): Promise<string[]> {
  const files: string[] = [];

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      // Skip hidden files/folders and common Obsidian system folders
      if (entry.name.startsWith(".") || entry.name === ".obsidian") {
        continue;
      }

      if (entry.isDirectory()) {
        const subFiles = await findMarkdownFiles(fullPath, baseDir);
        files.push(...subFiles);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(fullPath);
      }
    }
  } catch (error) {
    console.error(`Error reading directory ${dir}:`, error);
  }

  return files;
}

/**
 * Parse a single Obsidian markdown file
 */
export async function parseObsidianFile(
  filePath: string,
  baseDir: string
): Promise<ParsedObsidianFile | null> {
  try {
    const fileContent = await fs.readFile(filePath, "utf-8");

    // Parse frontmatter
    const { data: frontmatter, content: contentWithoutFrontmatter } = matter(fileContent);

    // Determine title (priority: frontmatter > H1 > filename)
    let title = frontmatter.title as string | undefined;

    if (!title) {
      // Try to find H1 heading
      const h1Match = contentWithoutFrontmatter.match(/^#\s+(.+)$/m);
      if (h1Match) {
        title = h1Match[1].trim();
      }
    }

    if (!title) {
      // Use filename (without .md extension)
      title = path.basename(filePath, ".md");
    }

    // Extract wikilinks
    const wikilinks = extractWikilinks(contentWithoutFrontmatter);

    // Extract tags from frontmatter and inline
    const tags: string[] = [];

    // Frontmatter tags (can be array or string)
    if (frontmatter.tags) {
      if (Array.isArray(frontmatter.tags)) {
        tags.push(...frontmatter.tags.map((t: string) => t.toLowerCase()));
      } else if (typeof frontmatter.tags === "string") {
        tags.push(...frontmatter.tags.split(",").map((t: string) => t.trim().toLowerCase()));
      }
    }

    // Inline hashtags
    const hashtagRegex = /#([a-zA-Z][a-zA-Z0-9_-]*)/g;
    let match;
    while ((match = hashtagRegex.exec(contentWithoutFrontmatter)) !== null) {
      const tag = match[1].toLowerCase();
      if (!tags.includes(tag)) {
        tags.push(tag);
      }
    }

    // Calculate relative folder path
    const relativePath = path.relative(baseDir, path.dirname(filePath));
    const folder = relativePath || "root";

    return {
      title,
      content: fileContent,
      contentWithoutFrontmatter,
      frontmatter,
      wikilinks,
      tags,
      folder,
      filePath,
    };
  } catch (error) {
    console.error(`Error parsing file ${filePath}:`, error);
    return null;
  }
}

/**
 * Create a URL-safe slug from a string
 */
function createSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .substring(0, 100);
}

/**
 * Check if a note with the same title already exists
 */
async function checkDuplicate(
  userId: string,
  title: string
): Promise<Note | null> {
  return queryOne<Note>(
    `SELECT * FROM notes WHERE user_id = ? AND title = ? LIMIT 1`,
    [userId, title]
  );
}

/**
 * Cache for project lookups to avoid repeated DB queries
 */
const projectCache = new Map<string, { id: string; name: string }>();

/**
 * Get or create a nested project hierarchy from a folder path
 * e.g., "Personal Projects - Future/Cedar Line/RSO" creates:
 *   - "Personal Projects - Future" (parent)
 *   - "Cedar Line" (child of above)
 *   - "RSO" (child of above) <- returns this one
 */
async function getOrCreateNestedProject(
  userId: string,
  folderPath: string,
  createdProjects: Set<string>
): Promise<{ id: string; name: string; isNew: boolean }> {
  const parts = folderPath.split("/").filter(p => p.length > 0);

  if (parts.length === 0) {
    throw new Error("Empty folder path");
  }

  let parentId: string | null = null;
  let lastProject: { id: string; name: string; isNew: boolean } | null = null;

  // Build the path incrementally and create each level
  for (let i = 0; i < parts.length; i++) {
    const partName = parts[i].replace(/-/g, " ").replace(/_/g, " ").trim();
    const currentPath = parts.slice(0, i + 1).join("/");
    const cacheKey = `${userId}:${currentPath}`;

    // Check cache first
    const cached = projectCache.get(cacheKey);
    if (cached) {
      parentId = cached.id;
      lastProject = { ...cached, isNew: false };
      continue;
    }

    // Generate a unique slug that includes parent context
    const slugBase = createSlug(partName);
    const slugWithContext: string = parentId
      ? `${slugBase}-${parentId.substring(0, 8)}`
      : slugBase;

    // Check if project exists at this level
    let existing: Project | null;
    if (parentId) {
      existing = await queryOne<Project>(
        `SELECT * FROM projects WHERE user_id = ? AND name = ? AND parent_id = ?`,
        [userId, partName, parentId]
      );
    } else {
      existing = await queryOne<Project>(
        `SELECT * FROM projects WHERE user_id = ? AND name = ? AND parent_id IS NULL`,
        [userId, partName]
      );
    }

    if (existing) {
      projectCache.set(cacheKey, { id: existing.id, name: existing.name });
      parentId = existing.id;
      lastProject = { id: existing.id, name: existing.name, isNew: false };
      continue;
    }

    // Create new project at this level
    const newProject: { id: string } | null = await mutate<{ id: string }>(
      `INSERT INTO projects (user_id, name, slug, description, status, parent_id)
       VALUES (?, ?, ?, ?, 'active', ?)
       RETURNING id`,
      [
        userId,
        partName,
        slugWithContext,
        `Imported from Obsidian: ${currentPath}`,
        parentId
      ]
    );

    if (!newProject) {
      throw new Error(`Failed to create project: ${partName}`);
    }

    projectCache.set(cacheKey, { id: newProject.id, name: partName });
    createdProjects.add(currentPath);
    parentId = newProject.id;
    lastProject = { id: newProject.id, name: partName, isNew: true };
  }

  if (!lastProject) {
    throw new Error(`Failed to create project hierarchy: ${folderPath}`);
  }

  return lastProject;
}

/**
 * Clear the project cache (call before new import session)
 */
export function clearProjectCache(): void {
  projectCache.clear();
}

/**
 * Import a single note into Brain Portal
 */
async function importNote(
  userId: string,
  parsed: ParsedObsidianFile,
  projectId: string | null,
  dryRun: boolean
): Promise<string | null> {
  if (dryRun) {
    return "dry-run-id";
  }

  const slug = createSlug(parsed.title);
  const contentPlain = stripMarkdown(parsed.contentWithoutFrontmatter);
  const wordCount = countWords(parsed.contentWithoutFrontmatter);

  // Ensure unique slug
  let finalSlug = slug;
  let counter = 1;
  while (true) {
    const existing = await queryOne<Note>(
      `SELECT id FROM notes WHERE user_id = ? AND slug = ?`,
      [userId, finalSlug]
    );
    if (!existing) break;
    finalSlug = `${slug}-${counter++}`;
  }

  const result = await mutate<{ id: string }>(
    `INSERT INTO notes (
      user_id, project_id, title, slug, content, content_plain,
      note_type, word_count, frontmatter, processing_status
    ) VALUES (?, ?, ?, ?, ?, ?, 'note', ?, ?, 'pending')
    RETURNING id`,
    [
      userId,
      projectId,
      parsed.title,
      finalSlug,
      parsed.content,
      contentPlain,
      wordCount,
      JSON.stringify(parsed.frontmatter),
    ]
  );

  return result?.id || null;
}

/**
 * Queue processing jobs for an imported note
 */
async function queueProcessingJobs(
  userId: string,
  noteId: string,
  wordCount: number
): Promise<void> {
  // Always queue embedding generation
  await enqueue({
    userId,
    entityType: "note",
    entityId: noteId,
    operation: "generate_embedding",
    tier: "embedding",
    priority: 5,
  });

  // Queue summary generation if note is substantial
  if (wordCount >= 50) {
    await enqueue({
      userId,
      entityType: "note",
      entityId: noteId,
      operation: "generate_summary",
      tier: "fast_llm",
      priority: 3,
    });

    await enqueue({
      userId,
      entityType: "note",
      entityId: noteId,
      operation: "generate_tags",
      tier: "fast_llm",
      priority: 2,
    });
  }

  // Queue connection discovery
  await enqueue({
    userId,
    entityType: "note",
    entityId: noteId,
    operation: "find_connections",
    tier: "embedding",
    priority: 1,
  });
}

/**
 * Main import function - imports an Obsidian vault
 */
export async function importObsidianVault(
  options: ImportOptions
): Promise<ImportResult> {
  const {
    vaultPath,
    userId,
    mapFoldersToProjects,
    skipDuplicates,
    folderFilter,
    dryRun = false,
  } = options;

  // Clear project cache for fresh import
  clearProjectCache();

  const result: ImportResult = {
    success: true,
    imported: 0,
    skipped: 0,
    errors: [],
    projectsCreated: [],
    notes: [],
  };

  const createdProjects = new Set<string>();

  // Verify vault path exists
  try {
    const stat = await fs.stat(vaultPath);
    if (!stat.isDirectory()) {
      throw new Error("Path is not a directory");
    }
  } catch (error) {
    result.success = false;
    result.errors.push(`Invalid vault path: ${vaultPath}`);
    return result;
  }

  // Find all markdown files
  const files = await findMarkdownFiles(vaultPath);
  console.log(`Found ${files.length} markdown files`);

  // Filter by folders if specified
  let filteredFiles = files;
  if (folderFilter && folderFilter.length > 0) {
    filteredFiles = files.filter((f) => {
      const relativePath = path.relative(vaultPath, f);
      return folderFilter.some((folder) => relativePath.startsWith(folder));
    });
    console.log(`Filtered to ${filteredFiles.length} files in specified folders`);
  }

  // Process each file
  for (const filePath of filteredFiles) {
    const parsed = await parseObsidianFile(filePath, vaultPath);

    if (!parsed) {
      result.errors.push(`Failed to parse: ${filePath}`);
      continue;
    }

    // Check for duplicates
    if (skipDuplicates) {
      const existing = await checkDuplicate(userId, parsed.title);
      if (existing) {
        result.skipped++;
        continue;
      }
    }

    // Get or create project hierarchy from folder path
    let projectId: string | null = null;
    let projectName: string | undefined;

    if (mapFoldersToProjects && parsed.folder !== "root") {
      try {
        const project = await getOrCreateNestedProject(userId, parsed.folder, createdProjects);
        projectId = project.id;
        projectName = project.name;
      } catch (error) {
        result.errors.push(`Failed to create project for folder ${parsed.folder}: ${error}`);
      }
    }

    // Import the note
    try {
      const noteId = await importNote(userId, parsed, projectId, dryRun);

      if (noteId) {
        const wordCount = countWords(parsed.contentWithoutFrontmatter);

        // Queue processing jobs (only if not dry run)
        if (!dryRun) {
          await queueProcessingJobs(userId, noteId, wordCount);
        }

        result.imported++;
        result.notes.push({
          id: noteId,
          title: parsed.title,
          folder: parsed.folder,
          projectId: projectId || undefined,
          projectName,
        });
      } else {
        result.errors.push(`Failed to insert note: ${parsed.title}`);
      }
    } catch (error) {
      result.errors.push(`Error importing ${parsed.title}: ${error}`);
    }
  }

  result.projectsCreated = Array.from(createdProjects);
  result.success = result.errors.length === 0;

  return result;
}

/**
 * Get a preview of what would be imported (dry run)
 */
export async function previewImport(
  vaultPath: string,
  folderFilter?: string[]
): Promise<{
  totalFiles: number;
  folders: string[];
  sampleFiles: Array<{ title: string; folder: string }>;
}> {
  const files = await findMarkdownFiles(vaultPath);

  let filteredFiles = files;
  if (folderFilter && folderFilter.length > 0) {
    filteredFiles = files.filter((f) => {
      const relativePath = path.relative(vaultPath, f);
      return folderFilter.some((folder) => relativePath.startsWith(folder));
    });
  }

  const folders = new Set<string>();
  const sampleFiles: Array<{ title: string; folder: string }> = [];

  for (const filePath of filteredFiles.slice(0, 20)) {
    const parsed = await parseObsidianFile(filePath, vaultPath);
    if (parsed) {
      folders.add(parsed.folder);
      sampleFiles.push({
        title: parsed.title,
        folder: parsed.folder,
      });
    }
  }

  return {
    totalFiles: filteredFiles.length,
    folders: Array.from(folders).sort(),
    sampleFiles,
  };
}
