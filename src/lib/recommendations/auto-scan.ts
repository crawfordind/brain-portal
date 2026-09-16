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
 * Check if auto-scan should be triggered for a daily note
 */
export async function shouldTriggerAutoScan(
  dailyNoteId: string,
  userId: string,
  content: string
): Promise<ScanTriggerResult> {

  const dailyNote = await queryOne<DailyNote>(
    'SELECT * FROM daily_notes WHERE id = ?',
    [dailyNoteId]
  );

  if (!dailyNote) {
    return { shouldScan: false, reason: 'Daily note not found' };
  }

  const metadata = JSON.parse(dailyNote.metadata || '{}');
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
 * Update daily note metadata after scan trigger check
 */
export async function updateScanMetadata(
  dailyNoteId: string,
  content: string,
  scanTriggered: boolean
): Promise<void> {

  const dailyNote = await queryOne<DailyNote>(
    'SELECT * FROM daily_notes WHERE id = ?',
    [dailyNoteId]
  );

  if (!dailyNote) return;

  const metadata = JSON.parse(dailyNote.metadata || '{}');
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
    sql: 'UPDATE daily_notes SET metadata = ?, updated_at = datetime("now") WHERE id = ?',
    args: [JSON.stringify(metadata), dailyNoteId]
  });
}
