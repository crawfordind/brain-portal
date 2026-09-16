/**
 * Date utilities for handling SQLite UTC timestamps
 *
 * SQLite stores dates as `datetime('now')` which returns UTC without timezone indicator.
 * JavaScript's Date parser treats these as local time, causing timezone offset issues.
 */

/**
 * Parse a SQLite datetime string as UTC
 * SQLite format: "2024-01-15 14:30:00" (no timezone indicator, but is UTC)
 * Converts to: "2024-01-15T14:30:00Z" (ISO 8601 with UTC indicator)
 */
export function parseUTCDate(dateString: string | null | undefined): Date {
  if (!dateString) {
    return new Date();
  }

  // If already has timezone indicator, use as-is
  if (dateString.includes('Z') || dateString.includes('+') || dateString.includes('T')) {
    return new Date(dateString);
  }

  // SQLite datetime format: "YYYY-MM-DD HH:MM:SS"
  // Convert to ISO 8601 with UTC indicator
  const isoString = dateString.replace(' ', 'T') + 'Z';
  return new Date(isoString);
}

/**
 * Format a SQLite datetime as relative time (e.g., "2 hours ago")
 */
export function formatRelativeTime(dateString: string | null | undefined): string {
  const date = parseUTCDate(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) {
    return 'just now';
  } else if (diffMinutes < 60) {
    return `${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''} ago`;
  } else if (diffHours < 24) {
    return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
  } else if (diffDays < 7) {
    return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
  } else {
    // For older dates, show actual date
    return date.toLocaleDateString();
  }
}
