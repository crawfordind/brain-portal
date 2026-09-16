// src/app/api/notes/[id]/analyze/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { queryOne, db } from '@/lib/db/client';
import { analyzeNoteContent } from '@/lib/analysis/analyzer';
import type { Note } from '@/lib/db/schema';

interface RouteParams {
  params: Promise<{ id: string }>;
}

const MIN_NOTE_LENGTH = 50;

// POST /api/notes/[id]/analyze - Deep analysis of note content
export async function POST(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  try {
    const note = await queryOne<Note>(
      'SELECT * FROM notes WHERE id = ? AND user_id = ?',
      [id, user.id]
    );

    if (!note) {
      return NextResponse.json({ error: 'Note not found' }, { status: 404 });
    }

    if (!note.content || note.content.trim().length < MIN_NOTE_LENGTH) {
      return NextResponse.json(
        { error: 'Note is too short for meaningful analysis. Add more content first.' },
        { status: 400 }
      );
    }

    // Log analysis start
    await db.execute({
      sql: `INSERT INTO activity_log (user_id, entity_type, entity_id, action, changes)
            VALUES (?, ?, ?, ?, ?)`,
      args: [
        user.id,
        'note',
        id,
        'analysis_started',
        JSON.stringify({
          title: note.title,
          wordCount: note.word_count,
          timestamp: new Date().toISOString(),
        }),
      ],
    });

    const result = await analyzeNoteContent(
      user.id,
      id,
      note.title,
      note.content
    );

    // Log analysis completion
    await db.execute({
      sql: `INSERT INTO activity_log (user_id, entity_type, entity_id, action, changes)
            VALUES (?, ?, ?, ?, ?)`,
      args: [
        user.id,
        'note',
        id,
        'analysis_completed',
        JSON.stringify({
          sections: {
            keyFindings: result.keyFindings.length,
            researchThreads: result.researchThreads.length,
            actionItems: result.actionItems.length,
            openQuestions: result.openQuestions.length,
            entities: result.entities.length,
            links: result.links.length,
            relatedNotes: result.relatedNoteIds.length,
          },
          complexity: result.complexity,
        }),
      ],
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error(`Analysis failed for note ${id}:`, error);

    if (error instanceof Error) {
      if ('status' in error) {
        const status = (error as { status: number }).status;
        if (status === 429) {
          return NextResponse.json(
            { error: 'AI service rate limit reached. Please try again in a minute.' },
            { status: 429 }
          );
        }
      }
      if (error.message.includes('rate_limit') || error.message.includes('429')) {
        return NextResponse.json(
          { error: 'AI service rate limit reached. Please try again in a minute.' },
          { status: 429 }
        );
      }
      if (error.message.includes('timeout') || error.message.includes('timed out')) {
        return NextResponse.json(
          { error: 'Analysis timed out. The note may be too long — try a shorter note.' },
          { status: 408 }
        );
      }
    }

    return NextResponse.json(
      { error: 'Analysis failed. Please try again.' },
      { status: 500 }
    );
  }
}

// POST /api/notes/[id]/analyze/save - Save analysis as a new note
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  try {
    const body = await request.json();
    const { title, content, projectId } = body as {
      title: string;
      content: string;
      projectId?: string | null;
    };

    if (!title || !content) {
      return NextResponse.json({ error: 'Title and content are required' }, { status: 400 });
    }

    // Verify source note exists
    const sourceNote = await queryOne<Note>(
      'SELECT id, title, project_id FROM notes WHERE id = ? AND user_id = ?',
      [id, user.id]
    );

    if (!sourceNote) {
      return NextResponse.json({ error: 'Source note not found' }, { status: 404 });
    }

    // Generate slug
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 60) + '-' + Date.now().toString(36);

    // Count words
    const wordCount = content.split(/\s+/).filter((w: string) => w.length > 0).length;

    // Create the analysis note
    const result = await db.execute({
      sql: `INSERT INTO notes (user_id, project_id, title, slug, content, content_plain, note_type, word_count)
            VALUES (?, ?, ?, ?, ?, ?, 'insight', ?)
            RETURNING *`,
      args: [
        user.id,
        projectId ?? sourceNote.project_id,
        title,
        slug,
        content,
        content,
        wordCount,
      ],
    });

    const newNote = result.rows[0];

    // Create connection between source and analysis note
    if (newNote) {
      await db.execute({
        sql: `INSERT OR IGNORE INTO note_connections
              (user_id, source_note_id, target_note_id, connection_type, strength, reason, is_manual, discovery_method)
              VALUES (?, ?, ?, 'extends', 0.9, 'AI analysis of source note', FALSE, 'llm')`,
        args: [user.id, id, newNote.id],
      });
    }

    // Log activity
    await db.execute({
      sql: `INSERT INTO activity_log (user_id, entity_type, entity_id, action, changes)
            VALUES (?, ?, ?, ?, ?)`,
      args: [
        user.id,
        'note',
        id,
        'analysis_saved',
        JSON.stringify({
          newNoteId: newNote?.id,
          newNoteTitle: title,
        }),
      ],
    });

    return NextResponse.json({
      note: newNote,
      slug,
    });
  } catch (error) {
    console.error(`Failed to save analysis for note ${id}:`, error);
    return NextResponse.json(
      { error: 'Failed to save analysis. Please try again.' },
      { status: 500 }
    );
  }
}
