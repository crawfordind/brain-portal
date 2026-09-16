import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { query, mutate } from "@/lib/db/client";
import type { Attachment } from "@/lib/db/schema";
import { uploadToR2 } from "@/lib/storage/r2";
import {
  validateFile,
  calculateHash,
  generateStorageKey,
} from "@/lib/storage/validation";
import { parseDataUrl, extensionForMime } from "@/lib/storage/data-url";
import { enqueue } from "@/lib/processing/queue";
import { recognizeHandwriting } from "@/lib/ai/handwriting";

interface RecognizeBody {
  /** Image as a base64 data URL (e.g. canvas.toDataURL output). Required. */
  image?: string;
  /** Run handwriting recognition. Default true. */
  recognize?: boolean;
  /** Persist the sketch as an image attachment. Default false. */
  persist?: boolean;
  /** Vector stroke data, stored in attachment metadata so the sketch stays editable. */
  strokes?: unknown;
  /** Optional title used as the attachment filename / note linkage. */
  title?: string;
  noteId?: string | null;
  projectId?: string | null;
}

// POST /api/ink/recognize — recognize handwriting in a sketch and optionally
// store it as an attachment (with the transcription saved as extracted_text).
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: RecognizeBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { image, strokes, title, noteId, projectId } = body;
  const shouldRecognize = body.recognize !== false;
  const shouldPersist = body.persist === true;

  if (!image || typeof image !== "string") {
    return NextResponse.json(
      { error: "Missing 'image' (base64 data URL)" },
      { status: 400 }
    );
  }

  const parsed = parseDataUrl(image);
  if (!parsed || !parsed.mimeType.startsWith("image/")) {
    return NextResponse.json(
      { error: "Image must be a base64-encoded image data URL" },
      { status: 400 }
    );
  }

  // 1. Recognize handwriting (synchronous so the user gets immediate feedback).
  let recognition = null;
  if (shouldRecognize) {
    try {
      recognition = await recognizeHandwriting(image);
    } catch (error) {
      console.error("Handwriting recognition failed:", error);
      // Don't fail the whole request — persistence may still be useful.
      recognition = null;
    }
  }

  // 2. Optionally persist the rasterized sketch as an attachment.
  let attachment: Attachment | null = null;
  if (shouldPersist) {
    const { mimeType, buffer } = parsed;

    const validation = await validateFile(buffer, mimeType, `sketch.${extensionForMime(mimeType)}`);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const baseName = (title?.trim() || "Sketch")
      .replace(/[\n\r]+/g, " ")
      .slice(0, 80);
    const filename = `${baseName}.${extensionForMime(mimeType)}`;
    const contentHash = calculateHash(buffer);

    // Dedupe against an identical sketch already uploaded by this user.
    const existing = await query<Attachment>(
      "SELECT * FROM attachments WHERE user_id = ? AND content_hash = ? LIMIT 1",
      [user.id, contentHash]
    );

    if (existing.length > 0) {
      attachment = existing[0];
    } else {
      const storageKey = generateStorageKey(user.id, contentHash, filename);

      let storageUrl: string;
      try {
        storageUrl = await uploadToR2(storageKey, buffer, mimeType);
      } catch (error) {
        console.error("R2 upload failed:", error);
        return NextResponse.json(
          { error: "Failed to upload sketch to storage" },
          { status: 500 }
        );
      }

      const transcription = recognition?.text || "";
      const description =
        recognition?.description ||
        (recognition?.hasText ? "Handwritten note" : "Hand-drawn sketch");
      const contentPlain = [transcription, recognition?.description]
        .filter(Boolean)
        .join("\n\n");

      const metadata = JSON.stringify({
        isSketch: true,
        source: "sketch_pad",
        ink: strokes ?? null,
        handwriting: recognition ?? null,
      });

      attachment = await mutate<Attachment>(
        `INSERT INTO attachments (
          user_id, filename, original_filename, mime_type, file_size,
          storage_key, storage_url, file_type, project_id, note_id,
          extracted_text, description, content_plain, content_hash,
          metadata, tags, processing_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'image', ?, ?, ?, ?, ?, ?, ?, '["sketch"]', 'completed')
        RETURNING *`,
        [
          user.id,
          filename,
          filename,
          mimeType,
          buffer.length,
          storageKey,
          storageUrl,
          projectId || null,
          noteId || null,
          transcription || null,
          description,
          contentPlain || null,
          contentHash,
          metadata,
        ]
      );

      // Make the sketch + its transcription semantically searchable.
      if (attachment && contentPlain.trim()) {
        try {
          await enqueue({
            userId: user.id,
            entityType: "attachment",
            entityId: attachment.id,
            operation: "generate_embedding",
            tier: "embedding",
            priority: 0,
          });
        } catch (queueError) {
          console.error("Failed to enqueue sketch embedding:", queueError);
        }
      }
    }
  }

  return NextResponse.json({ recognition, attachment }, { status: 200 });
}
