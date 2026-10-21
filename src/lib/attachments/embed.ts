/**
 * An attachment as note HTML. Imports nothing, so the note page and the
 * editor can both use it.
 *
 * Notes are stored as HTML. The note page used to append Markdown
 * (`![name](url)`) to that HTML, which the editor then showed as literal text,
 * and the editor built `<a href="${url}">${filename}</a>` by interpolation, so
 * a filename with a quote or a tag in it broke out of the markup.
 */

export interface EmbeddableAttachment {
  filename: string;
  storage_url: string;
  file_type: string;
  description?: string | null;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Only web URLs are linked; anything else (javascript:, data:) is refused. */
export function safeAttachmentUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function attachmentToHtml(attachment: EmbeddableAttachment): string {
  const url = safeAttachmentUrl(attachment.storage_url);
  const name = escapeHtml(attachment.filename);
  if (!url) return `<p>${name}</p>`;

  const href = escapeHtml(url);
  if (attachment.file_type === 'image') {
    const alt = escapeHtml(attachment.description?.trim() || attachment.filename);
    return `<figure data-align="left"><img src="${href}" alt="${alt}" title="${name}"><figcaption></figcaption></figure>`;
  }
  return `<p><a href="${href}">${name}</a></p>`;
}
