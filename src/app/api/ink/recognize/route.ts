import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import type { Attachment } from "@/lib/db/schema";
import { isR2Configured } from "@/lib/storage/r2";
import { parseDataUrl, extensionForMime } from "@/lib/storage/data-url";
import { recognizeHandwriting } from "@/lib/ai/handwriting";
import { createAttachment, resolveAttachmentLinks } from "@/lib/attachments/create";
import { attachmentErrorResponse, storageNotConfigured } from "@/lib/attachments/http";

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

  // Refuse before spending a model call on a sketch that cannot be saved
  let links: { noteId: string | null; projectId: string | null } = { noteId: null, projectId: null };
  if (shouldPersist) {
    if (!isR2Configured()) return storageNotConfigured();
    try {
      links = await resolveAttachmentLinks(user.id, { noteId, projectId });
    } catch (error) {
      return attachmentErrorResponse(error, "Could not save the sketch");
    }
  }

  // 1. Recognize handwriting (synchronous so the user gets immediate feedback).
  let recognition = null;
  if (shouldRecognize) {
    try {
      recognition = await recognizeHandwriting(image, { userId: user.id });
    } catch (error) {
      console.error("Handwriting recognition failed:", error);
      // Don't fail the whole request — persistence may still be useful.
      recognition = null;
    }
  }

  // 2. Optionally persist the rasterized sketch as an attachment. It arrives
  // already processed (the transcription is its text), so no jobs are queued,
  // and it is found by full-text search over that transcription.
  let attachment: Attachment | null = null;
  if (shouldPersist) {
    const { mimeType, buffer } = parsed;

    const baseName = (title?.trim() || "Sketch")
      .replace(/[\n\r]+/g, " ")
      .slice(0, 80);
    const filename = `${baseName}.${extensionForMime(mimeType)}`;

    const transcription = recognition?.text || "";
    const description =
      recognition?.description ||
      (recognition?.hasText ? "Handwritten note" : "Hand-drawn sketch");
    const contentPlain = [description, transcription].filter(Boolean).join("\n\n");

    try {
      ({ attachment } = await createAttachment({
        userId: user.id,
        buffer,
        declaredType: mimeType,
        filename,
        ...links,
        description,
        tags: ["sketch"],
        preprocessed: {
          extractedText: transcription || null,
          contentPlain: contentPlain || null,
          metadata: {
            isSketch: true,
            source: "sketch_pad",
            ink: strokes ?? null,
            handwriting: recognition ?? null,
          },
        },
      }));
    } catch (error) {
      return attachmentErrorResponse(error, "Failed to save the sketch");
    }
  }

  return NextResponse.json({ recognition, attachment }, { status: 200 });
}
