import { queryOne, db } from '@/lib/db/client';
import { DailyNote } from '@/lib/db/schema';
import { countWords } from './utils';
import { hashContent } from '@/lib/processing/cache';

const INACTIVITY_THRESHOLD_MINUTES = 5;
const WORD_DELTA_THRESHOLD = 50;
const SCAN_COOLDOWN_MINUTES = 10;

export interface ScanTriggerResult {
  shouldScan: boolean;
  reason?: string;
}

/**
 * Which table holds the note whose scan state we are tracking.
 *
 * Auto-scan originally only ever ran on daily notes, so the table was
 * hardcoded. Ordinary notes are where most task-shaped sentences actually get
 * written, and they were never scanned unless the user pressed a button they
 * had to find first. Both tables carry a `metadata` JSON column, so the same
 * bookkeeping works for either.
 */
export type ScanSourceTable = "daily_notes" | "notes";

/** Only these two literals are ever interpolated into the SQL below. */
const SCAN_TABLES: Record<ScanSourceTable, string> = {
  daily_notes: "daily_notes",
  notes: "notes",
};

/**
 * Check if auto-scan should be triggered for a daily note
 */
export async function shouldTriggerAutoScan(
  noteId: string,
  userId: string,
  content: string,
  table: ScanSourceTable = "daily_notes"
): Promise<ScanTriggerResult> {

  const row = await queryOne<{ metadata: string | null }>(
    `SELECT metadata FROM ${SCAN_TABLES[table]} WHERE id = ?`,
    [noteId]
  );

  if (!row) {
    return { shouldScan: false, reason: 'Note not found' };
  }

  const metadata = JSON.parse(row.metadata || '{}');
  const now = new Date();

  // Calculate inactivity
  const lastActivity = metadata.last_user_activity_at
    ? new Date(metadata.last_user_activity_at)
    : now;
  const inactiveMinutes = (now.getTime() - lastActivity.getTime()) / 1000 / 60;

  // Calculate content delta
  const currentWordCount = countWords(content);
  const lastScanWordCount = metadata.last_scan_word_count || 0;
  const wordsDelta = currentWordCount - lastScanWordCount;

  // Check last scan time
  const lastScan = metadata.last_scan_at ? new Date(metadata.last_scan_at) : null;
  const minutesSinceLastScan = lastScan
    ? (now.getTime() - lastScan.getTime()) / 1000 / 60
    : 999;

  // Check conditions
  if (inactiveMinutes < INACTIVITY_THRESHOLD_MINUTES) {
    return { shouldScan: false, reason: 'User still active' };
  }

  if (wordsDelta < WORD_DELTA_THRESHOLD) {
    return { shouldScan: false, reason: 'Not enough new content' };
  }

  if (minutesSinceLastScan < SCAN_COOLDOWN_MINUTES) {
    return { shouldScan: false, reason: 'Scan cooldown period' };
  }

  return { shouldScan: true };
}

/**
 * Record that we looked, and what the note looked like when we did.
 */
export async function updateScanMetadata(
  noteId: string,
  content: string,
  scanTriggered: boolean,
  table: ScanSourceTable = "daily_notes"
): Promise<void> {

  const row = await queryOne<{ metadata: string | null }>(
    `SELECT metadata FROM ${SCAN_TABLES[table]} WHERE id = ?`,
    [noteId]
  );

  if (!row) return;

  const metadata = JSON.parse(row.metadata || '{}');
  const now = new Date();

  // Always update activity timestamp
  metadata.last_user_activity_at = now.toISOString();

  if (scanTriggered) {
    // Update scan metadata
    metadata.last_scan_at = now.toISOString();
    metadata.last_scan_word_count = countWords(content);
    metadata.last_scan_content_hash = hashContent(content);
  }

  await db.execute({
    sql: `UPDATE ${SCAN_TABLES[table]} SET metadata = ?, updated_at = datetime('now') WHERE id = ?`,
    args: [JSON.stringify(metadata), noteId]
  });
}
