import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  importObsidianVault,
  previewImport,
  type ImportOptions,
} from "@/lib/import/obsidian";
import path from "path";

const ALLOWED_VAULT_ROOT = process.env.OBSIDIAN_VAULT_ROOT || null;

function isAllowedVaultPath(vaultPath: string): boolean {
  const resolved = path.resolve(vaultPath);
  if (resolved.includes("..")) return false;
  if (!ALLOWED_VAULT_ROOT) return false;
  const allowedResolved = path.resolve(ALLOWED_VAULT_ROOT);
  return resolved === allowedResolved || resolved.startsWith(allowedResolved + path.sep);
}

// POST /api/import/obsidian - Import notes from Obsidian vault
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const {
      vaultPath,
      folderFilter,
      dryRun = false,
      mapFoldersToProjects = true,
      skipDuplicates = true,
    } = body;

    if (!vaultPath || typeof vaultPath !== "string") {
      return NextResponse.json(
        { error: "vaultPath is required" },
        { status: 400 }
      );
    }

    if (!isAllowedVaultPath(vaultPath)) {
      return NextResponse.json(
        { error: "vaultPath must be within the configured OBSIDIAN_VAULT_ROOT" },
        { status: 403 }
      );
    }

    // If dry run, return preview
    if (dryRun) {
      const preview = await previewImport(vaultPath, folderFilter);
      return NextResponse.json({
        success: true,
        dryRun: true,
        ...preview,
      });
    }

    // Perform the import
    const options: ImportOptions = {
      vaultPath,
      userId: user.id,
      mapFoldersToProjects,
      skipDuplicates,
      folderFilter,
      dryRun: false,
    };

    const result = await importObsidianVault(options);

    return NextResponse.json({
      message: `Imported ${result.imported} notes, skipped ${result.skipped}, ${result.errors.length} errors`,
      ...result,
    });
  } catch (error) {
    console.error("Import error:", error);
    return NextResponse.json(
      { error: "Import failed" },
      { status: 500 }
    );
  }
}

// GET /api/import/obsidian - Get preview of files in vault
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const vaultPath = searchParams.get("vaultPath");

    if (!vaultPath) {
      return NextResponse.json(
        { error: "vaultPath query parameter is required" },
        { status: 400 }
      );
    }

    if (!isAllowedVaultPath(vaultPath)) {
      return NextResponse.json(
        { error: "vaultPath must be within the configured OBSIDIAN_VAULT_ROOT" },
        { status: 403 }
      );
    }

    const folderFilterParam = searchParams.get("folders");
    const folderFilter = folderFilterParam
      ? folderFilterParam.split(",")
      : undefined;

    const preview = await previewImport(vaultPath, folderFilter);

    return NextResponse.json({
      success: true,
      vaultPath,
      ...preview,
    });
  } catch (error) {
    console.error("Preview error:", error);
    return NextResponse.json(
      { error: "Preview failed" },
      { status: 500 }
    );
  }
}
