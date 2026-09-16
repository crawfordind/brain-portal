/**
 * Helpers for working with base64 data URLs (e.g. canvas.toDataURL output).
 */

export interface ParsedDataUrl {
  mimeType: string;
  buffer: Buffer;
}

/**
 * Parse a base64 data URL into its MIME type and decoded bytes.
 *
 * Accepts strings of the form `data:<mime>;base64,<payload>`. Returns `null`
 * for anything that isn't a base64 data URL (remote URLs, malformed input,
 * empty payloads).
 */
export function parseDataUrl(dataUrl: string): ParsedDataUrl | null {
  if (typeof dataUrl !== "string") return null;

  const match = dataUrl.match(/^data:([^;,]+);base64,([\s\S]+)$/);
  if (!match) return null;

  const mimeType = match[1].trim().toLowerCase();
  const payload = match[2].trim();
  if (!payload) return null;

  let buffer: Buffer;
  try {
    buffer = Buffer.from(payload, "base64");
  } catch {
    return null;
  }

  if (buffer.length === 0) return null;

  return { mimeType, buffer };
}

/**
 * Map an image MIME type to a sensible file extension.
 */
export function extensionForMime(mimeType: string): string {
  switch (mimeType) {
    case "image/png":
      return "png";
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/svg+xml":
      return "svg";
    default:
      return "bin";
  }
}
