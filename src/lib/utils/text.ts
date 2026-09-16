/**
 * Text utility functions for content processing
 */

/**
 * Get a preview of note content
 * @param contentPlain - Pre-processed plain text content
 * @param htmlContent - HTML content as fallback
 * @param maxLength - Maximum length of preview
 * @returns Truncated preview with ellipsis if needed
 */
export function getContentPreview(
  contentPlain: string | undefined | null,
  htmlContent: string,
  maxLength = 100
): string {
  // Use content_plain if available
  if (contentPlain && contentPlain.trim()) {
    const trimmed = contentPlain.trim();
    return trimmed.length > maxLength
      ? trimmed.slice(0, maxLength).trim() + '...'
      : trimmed;
  }

  // Fallback: strip HTML tags from content
  const stripped = htmlContent
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return stripped.length > maxLength
    ? stripped.slice(0, maxLength).trim() + '...'
    : stripped;
}
