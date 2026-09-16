// src/app/api/notes/[id]/cleanup/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { queryOne, db, mutate } from '@/lib/db/client';
import { analyzeNote } from '@/lib/cleanup/analyzer';
import { applySuggestions } from '@/lib/cleanup/applier';
import type { Note } from '@/lib/db/schema';
import type { CleanupSuggestion } from '@/lib/cleanup/types';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// Minimum note length for cleanup analysis
const MIN_NOTE_LENGTH_FOR_CLEANUP = 100;

// POST /api/notes/[id]/cleanup - Analyze note for cleanup suggestions
export async function POST(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  try {
    // Fetch note
    const note = await queryOne<Note>(
      'SELECT * FROM notes WHERE id = ? AND user_id = ?',
      [id, user.id]
    );

    if (!note) {
      return NextResponse.json({ error: 'Note not found' }, { status: 404 });
    }

    // Validate content exists
    if (!note.content || note.content.trim().length === 0) {
      return NextResponse.json(
        { message: 'Note has no content to analyze', suggestions: [] },
        { status: 200 }
      );
    }

    // Check minimum length
    if (note.content.length < MIN_NOTE_LENGTH_FOR_CLEANUP) {
      return NextResponse.json(
        { message: 'Note too short for cleanup suggestions', suggestions: [] },
        { status: 200 }
      );
    }

    // Create activity_log snapshot
    await db.execute({
      sql: `INSERT INTO activity_log (user_id, entity_type, entity_id, action, changes)
            VALUES (?, ?, ?, ?, ?)`,
      args: [
        user.id,
        'note',
        id,
        'cleanup_started',
        JSON.stringify({
          snapshot: {
            title: note.title,
            content: note.content,
            timestamp: new Date().toISOString(),
          },
        }),
      ],
    });

    // Analyze note
    const result = await analyzeNote(user.id, note.content);

    // Validate analyzer response
    if (!result || !Array.isArray(result.suggestions)) {
      console.error(`Invalid analyzer response for note ${id}`);
      return NextResponse.json(
        { error: 'Failed to analyze note. Please try again.' },
        { status: 500 }
      );
    }

    if (result.suggestions.length === 0) {
      return NextResponse.json({
        message: 'No improvements needed!',
        suggestions: [],
      });
    }

    console.log(`Cleanup analysis for note ${id}: ${result.suggestions.length} suggestions`);

    return NextResponse.json({
      suggestions: result.suggestions,
      chunked: result.chunked,
      chunkCount: result.chunkCount,
    });
  } catch (error) {
    console.error(`Cleanup analysis failed for note ${id}:`, error);

    // Better error type checking
    if (error instanceof Error) {
      // Check for OpenRouter/OpenAI specific errors
      if ('status' in error) {
        const status = (error as any).status;
        if (status === 429) {
          return NextResponse.json(
            { error: 'AI service rate limit reached. Please try again in a minute.' },
            { status: 429 }
          );
        }
        if (status === 408 || status === 504) {
          return NextResponse.json(
            { error: 'Analysis timed out. Try again or break note into smaller sections.' },
            { status: 408 }
          );
        }
      }

      // Fallback to string matching for other error sources
      if (error.message.includes('rate_limit') || error.message.includes('429')) {
        return NextResponse.json(
          { error: 'AI service rate limit reached. Please try again in a minute.' },
          { status: 429 }
        );
      }
      if (error.message.includes('timeout') || error.message.includes('timed out')) {
        return NextResponse.json(
          { error: 'Analysis timed out. Try again or break note into smaller sections.' },
          { status: 408 }
        );
      }
    }

    return NextResponse.json(
      { error: 'Failed to analyze note. Please try again.' },
      { status: 500 }
    );
  }
}

// PATCH /api/notes/[id]/cleanup - Apply approved suggestions
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  try {
    const body = await request.json();
    const { suggestions } = body as { suggestions: CleanupSuggestion[] };

    if (!suggestions || !Array.isArray(suggestions)) {
      return NextResponse.json(
        { error: 'Invalid suggestions provided' },
        { status: 400 }
      );
    }

    // Fetch current note
    const note = await queryOne<Note>(
      'SELECT * FROM notes WHERE id = ? AND user_id = ?',
      [id, user.id]
    );

    if (!note) {
      return NextResponse.json({ error: 'Note not found' }, { status: 404 });
    }

    const oldContent = note.content;

    // Apply suggestions
    const result = applySuggestions(note.content, suggestions, id);

    // Update note content
    const updatedNote = await mutate<Note>(
      `UPDATE notes SET content = ?, content_plain = ?, updated_at = datetime('now')
       WHERE id = ? AND user_id = ?
       RETURNING *`,
      [result.updatedContent, result.updatedContent, id, user.id]
    );

    // Create task recommendations
    let taskRecsCreated = 0;
    for (const taskRec of result.taskRecommendations) {
      await db.execute({
        sql: `INSERT INTO task_recommendations
              (user_id, source_type, source_id, source_text, recommended_task, reasoning, confidence, priority)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          user.id,
          taskRec.source_type,
          taskRec.source_id,
          taskRec.source_text,
          taskRec.recommended_task,
          taskRec.reasoning,
          taskRec.confidence,
          taskRec.priority,
        ],
      });
      taskRecsCreated++;
    }

    // Create activity_log entry
    await db.execute({
      sql: `INSERT INTO activity_log (user_id, entity_type, entity_id, action, changes)
            VALUES (?, ?, ?, ?, ?)`,
      args: [
        user.id,
        'note',
        id,
        'cleanup_applied',
        JSON.stringify({
          appliedSuggestions: suggestions,
          before: oldContent,
          after: result.updatedContent,
          taskRecommendationsCreated: taskRecsCreated,
          tagsAdded: result.suggestedTags,
        }),
      ],
    });

    console.log(`Cleanup applied to note ${id}: ${suggestions.length} suggestions, ${taskRecsCreated} tasks created`);

    return NextResponse.json({
      note: updatedNote,
      taskRecommendationsCreated: taskRecsCreated,
      suggestedTags: result.suggestedTags,
    });
  } catch (error) {
    console.error(`Failed to apply cleanup to note ${id}:`, error);
    return NextResponse.json(
      { error: 'Failed to apply cleanup. Please try again.' },
      { status: 500 }
    );
  }
}
