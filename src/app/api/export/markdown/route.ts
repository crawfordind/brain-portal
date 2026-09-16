import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { query } from "@/lib/db/client";
import type {
  Note,
  Capture,
  Project,
  DailyNote,
  WeeklyReview,
  Task,
  JournalEntry,
  Reminder,
  Insight,
  NoteConnection,
} from "@/lib/db/schema";
import {
  buildVaultFiles,
  type NoteWithRelations,
  type ExportOptions,
  DEFAULT_EXPORT_OPTIONS,
} from "@/lib/export/markdown-export";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);

    // Parse export options from query params
    const rawFormat = searchParams.get("format");
    const validFormats: ExportOptions["format"][] = ["obsidian", "standard"];
    const opts: ExportOptions = {
      format: validFormats.includes(rawFormat as ExportOptions["format"]) ? (rawFormat as ExportOptions["format"]) : DEFAULT_EXPORT_OPTIONS.format,
      includeNotes: searchParams.get("notes") !== "false",
      includeCaptures: searchParams.get("captures") !== "false",
      includeTasks: searchParams.get("tasks") !== "false",
      includeJournal: searchParams.get("journal") !== "false",
      includeReminders: searchParams.get("reminders") !== "false",
      includeInsights: searchParams.get("insights") !== "false",
      includeConnections: searchParams.get("connections") !== "false",
    };

    // Fetch all data in parallel based on options
    const [notes, projects, dailyNotes, weeklyReviews, noteTags, captures, tasks, journal, reminders, insights, connections] =
      await Promise.all([
        // Always fetch notes (needed for slug mapping even if not exported)
        query<Note & { project_name?: string; project_slug?: string }>(
          `SELECT n.*, p.name as project_name, p.slug as project_slug
           FROM notes n
           LEFT JOIN projects p ON n.project_id = p.id
           WHERE n.user_id = ?
           ORDER BY n.created_at ASC`,
          [user.id]
        ),
        query<Project>(
          `SELECT * FROM projects WHERE user_id = ? ORDER BY name ASC`,
          [user.id]
        ),
        query<DailyNote>(
          `SELECT * FROM daily_notes WHERE user_id = ?`,
          [user.id]
        ),
        query<WeeklyReview>(
          `SELECT * FROM weekly_reviews WHERE user_id = ?`,
          [user.id]
        ),
        query<{ note_id: string; tag_name: string }>(
          `SELECT nt.note_id, t.name as tag_name
           FROM note_tags nt
           JOIN tags t ON nt.tag_id = t.id
           WHERE t.user_id = ?`,
          [user.id]
        ),
        opts.includeCaptures
          ? query<Capture>(
              `SELECT * FROM captures WHERE user_id = ? ORDER BY captured_at ASC`,
              [user.id]
            )
          : Promise.resolve([]),
        opts.includeTasks
          ? query<Task & { project_name?: string; note_title?: string }>(
              `SELECT t.*, p.name as project_name, n.title as note_title
               FROM tasks t
               LEFT JOIN projects p ON t.project_id = p.id
               LEFT JOIN notes n ON t.note_id = n.id
               WHERE t.user_id = ?
               ORDER BY t.created_at ASC`,
              [user.id]
            )
          : Promise.resolve([]),
        opts.includeJournal
          ? query<JournalEntry>(
              `SELECT * FROM journal_entries WHERE user_id = ? ORDER BY date ASC`,
              [user.id]
            )
          : Promise.resolve([]),
        opts.includeReminders
          ? query<Reminder & { project_name?: string }>(
              `SELECT r.*, p.name as project_name
               FROM reminders r
               LEFT JOIN projects p ON r.project_id = p.id
               WHERE r.user_id = ?
               ORDER BY r.remind_at ASC`,
              [user.id]
            )
          : Promise.resolve([]),
        opts.includeInsights
          ? query<Insight>(
              `SELECT * FROM insights WHERE user_id = ? AND is_dismissed = FALSE ORDER BY generated_at DESC`,
              [user.id]
            )
          : Promise.resolve([]),
        opts.includeConnections
          ? query<NoteConnection>(
              `SELECT * FROM note_connections WHERE user_id = ?`,
              [user.id]
            )
          : Promise.resolve([]),
      ]);

    // Build lookup maps
    const dailyNoteMap = new Map<string, DailyNote>();
    for (const dn of dailyNotes) {
      dailyNoteMap.set(dn.note_id, dn);
    }

    const weeklyReviewMap = new Map<string, WeeklyReview>();
    for (const wr of weeklyReviews) {
      weeklyReviewMap.set(wr.note_id, wr);
    }

    const noteTagsMap = new Map<string, string[]>();
    for (const nt of noteTags) {
      if (!noteTagsMap.has(nt.note_id)) {
        noteTagsMap.set(nt.note_id, []);
      }
      noteTagsMap.get(nt.note_id)!.push(nt.tag_name);
    }

    // Enrich notes with relations
    const enrichedNotes: NoteWithRelations[] = notes.map((note) => ({
      ...note,
      daily_note: dailyNoteMap.get(note.id),
      weekly_review: weeklyReviewMap.get(note.id),
      tag_names: noteTagsMap.get(note.id),
    }));

    // Build vault files with all content types
    const files = buildVaultFiles(enrichedNotes, captures, projects, opts, {
      tasks,
      journal,
      reminders,
      insights,
      connections,
    });

    // Create ZIP (dynamic import keeps jszip out of the route's cold-start path;
    // it's only pulled in when an export is actually requested).
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    for (const file of files) {
      zip.file(file.path, file.content);
    }

    const zipBuffer = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });

    const dateStr = new Date().toISOString().split("T")[0];
    const formatSuffix = opts.format === "obsidian" ? "obsidian" : "markdown";
    return new NextResponse(new Uint8Array(zipBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="vault-${formatSuffix}-${dateStr}.zip"`,
        "Content-Length": String(zipBuffer.length),
      },
    });
  } catch (error) {
    console.error("Failed to export markdown vault:", error);
    return NextResponse.json(
      { error: "Failed to generate export" },
      { status: 500 }
    );
  }
}
