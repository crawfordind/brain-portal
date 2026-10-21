/**
 * Content processing for attachments
 * Handles extraction of text, metadata, thumbnails, and descriptions.
 *
 * The native and CommonJS-only libraries (sharp, pdf-parse, xlsx, mammoth) are
 * imported inside the function that needs them, so loading this module to run
 * one job does not load all four. They are listed in `serverExternalPackages`
 * so they resolve at runtime inside a serverless function.
 *
 * Model calls go through `completeMessages`, never a hand-built client: that is
 * what bills the attachment owner's own key and records the call in AI usage.
 * The caller runs each job inside `runWithAiUser(job.user_id, …)`.
 */

import type { Attachment } from '@/lib/db/schema';
import { completeMessages, parseJSONResponse } from '@/lib/ai/client';
import { downloadFromR2 } from '@/lib/storage/r2';
import { FILE_SIZE_LIMITS } from '@/lib/storage/upload-policy';

/**
 * Most extracted text kept per file. A 300-page PDF yields megabytes, which
 * would be stored in the row, copied into the FTS index and shipped to the
 * browser with every attachment list.
 */
export const MAX_EXTRACTED_CHARS = 200_000;

/** Larger recordings are not sent for transcription: one request, base64, would be huge. */
export const MAX_TRANSCRIBE_BYTES = 20 * 1024 * 1024;

/** Images sent for description are first scaled to fit this box. */
const DESCRIBE_MAX_DIMENSION = 1536;

/**
 * Download an attachment's bytes, capped at what its type may legally be, so
 * a stored object cannot be larger than an upload could have been.
 */
export async function downloadAttachment(attachment: Attachment): Promise<Buffer> {
  return downloadFromR2(attachment.storage_key, FILE_SIZE_LIMITS[attachment.file_type] ?? undefined);
}

/** Strip NULs (SQLite text and FTS choke on them) and cap the length. */
export function cleanExtractedText(text: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = text.replace(/\u0000/g, '').trim();
  return cleaned.length > MAX_EXTRACTED_CHARS ? cleaned.slice(0, MAX_EXTRACTED_CHARS) : cleaned;
}

/**
 * Extract EXIF metadata from images
 */
export async function extractImageMetadata(
  buffer: Buffer
): Promise<Record<string, unknown>> {
  const { default: sharp } = await import('sharp');
  const metadata = await sharp(buffer).metadata();

  const result: Record<string, unknown> = {
    width: metadata.width,
    height: metadata.height,
    format: metadata.format,
    space: metadata.space,
    channels: metadata.channels,
    depth: metadata.depth,
    density: metadata.density,
    hasAlpha: metadata.hasAlpha,
    orientation: metadata.orientation,
  };

  // Extract EXIF data if available
  if (metadata.exif) {
    try {
      const { default: exifReader } = await import('exif-reader');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const exifData = exifReader(metadata.exif) as any;
      result.exif = {
        make: exifData.Image?.Make,
        model: exifData.Image?.Model,
        dateTime: exifData.Photo?.DateTimeOriginal,
        exposureTime: exifData.Photo?.ExposureTime,
        fNumber: exifData.Photo?.FNumber,
        iso: exifData.Photo?.ISOSpeedRatings,
        focalLength: exifData.Photo?.FocalLength,
        gps: exifData.GPSInfo
          ? {
              latitude: exifData.GPSInfo.GPSLatitude,
              longitude: exifData.GPSInfo.GPSLongitude,
              altitude: exifData.GPSInfo.GPSAltitude,
            }
          : undefined,
      };
    } catch (exifError) {
      console.error('Failed to parse EXIF data:', exifError);
    }
  }

  return result;
}

/**
 * Generate thumbnail for images
 * Returns base64-encoded JPEG data
 */
export async function generateThumbnail(
  buffer: Buffer,
  size: number = 300
): Promise<string> {
  const { default: sharp } = await import('sharp');
  const thumbnail = await sharp(buffer)
    .rotate() // honour EXIF orientation, or phone photos come out sideways
    .resize(size, size, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 80 })
    .toBuffer();

  return thumbnail.toString('base64');
}

/**
 * Extract text from PDF files
 */
export async function extractPDFText(buffer: Buffer): Promise<{
  text: string;
  numPages: number;
  metadata: Record<string, unknown>;
}> {
  const { default: pdfParse } = await import('pdf-parse');
  const data = await pdfParse(buffer);

  return {
    text: data.text,
    numPages: data.numpages,
    metadata: data.info || {},
  };
}

/**
 * Extract text from Word documents (.docx)
 */
export async function extractWordText(buffer: Buffer): Promise<{
  text: string;
  metadata: Record<string, unknown>;
}> {
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ buffer });

  return {
    text: result.value,
    metadata: {
      messages: result.messages,
    },
  };
}

/**
 * Extract text from Excel spreadsheets (.xlsx, .xls)
 */
export async function extractExcelText(buffer: Buffer): Promise<{
  text: string;
  metadata: Record<string, unknown>;
}> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(buffer, { type: 'buffer' });

  const allText: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    // Convert sheet to CSV text
    const csv = XLSX.utils.sheet_to_csv(worksheet);
    allText.push(`=== ${sheetName} ===\n${csv}`);
  }

  return {
    text: allText.join('\n\n'),
    metadata: {
      sheetNames: workbook.SheetNames,
      numSheets: workbook.SheetNames.length,
    },
  };
}

/**
 * The image as a data URL a vision model can read: scaled down (a 12 MP photo
 * costs far more tokens and says no more) and re-encoded as JPEG, which also
 * makes HEIC readable where sharp can decode it.
 */
async function imageForModel(buffer: Buffer, mimeType: string): Promise<string | null> {
  try {
    const { default: sharp } = await import('sharp');
    const jpeg = await sharp(buffer)
      .rotate()
      .resize(DESCRIBE_MAX_DIMENSION, DESCRIBE_MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
  } catch {
    // Formats every vision model takes as they are
    if (['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mimeType)) {
      return `data:${mimeType};base64,${buffer.toString('base64')}`;
    }
    return null;
  }
}

/**
 * Describe an image with the vision model. Throws when the model call fails,
 * so the queue records why and retries; returns '' only when the image cannot
 * be decoded at all (a HEIC this sharp build cannot read).
 */
export async function generateImageDescription(
  buffer: Buffer,
  mimeType: string,
  userId: string
): Promise<string> {
  const imageUrl = await imageForModel(buffer, mimeType);
  if (!imageUrl) return '';

  const response = await completeMessages(
    [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Describe this image in 2-3 sentences. Focus on the main subject, key details, and any text visible in the image.',
          },
          { type: 'image_url', image_url: { url: imageUrl } },
        ],
      },
    ],
    {
      capability: 'vision',
      slot: 'vision',
      purpose: 'Attachment image description',
      userId,
      maxTokens: 300,
    }
  );

  return (response.content || '').trim();
}

const AUDIO_FORMATS: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/flac': 'flac',
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
};

/**
 * Transcribe a recording with the vision slot's model.
 *
 * Not every provider or model accepts audio; one that silently drops the audio
 * part would otherwise "transcribe" the instruction text. So the model must say
 * whether it heard anything, and an answer without audio stores nothing.
 */
export async function transcribeAudio(
  buffer: Buffer,
  mimeType: string,
  userId: string
): Promise<{ text: string; skipped?: string }> {
  if (buffer.length > MAX_TRANSCRIBE_BYTES) {
    return { text: '', skipped: 'Recording is too large to transcribe automatically.' };
  }

  const response = await completeMessages(
    [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              'Transcribe the attached audio. Respond with ONLY a JSON object: ' +
              '{"heard": boolean, "transcript": string}. Set heard to false, with an empty ' +
              'transcript, if there is no audio attached or you cannot hear it. Do not ' +
              'describe or summarise; transcribe the words spoken.',
          },
          {
            // OpenRouter's audio input part. The OpenAI SDK types only list
            // wav/mp3, while OpenRouter accepts every format above.
            type: 'input_audio',
            input_audio: { data: buffer.toString('base64'), format: AUDIO_FORMATS[mimeType] ?? 'mp3' },
          } as never,
        ],
      },
    ],
    {
      capability: 'vision',
      slot: 'vision',
      purpose: 'Attachment audio transcription',
      userId,
      maxTokens: 4000,
    }
  );

  const raw = response.content || '';
  try {
    const parsed = parseJSONResponse<{ heard?: boolean; transcript?: string }>(raw);
    if (parsed.heard === false) {
      return { text: '', skipped: 'The model could not read the recording.' };
    }
    return { text: typeof parsed.transcript === 'string' ? parsed.transcript.trim() : '' };
  } catch {
    return { text: '', skipped: 'The model did not return a transcript.' };
  }
}

const WORD_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const EXCEL_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
]);

/**
 * Extract text content based on file type. Types with no extractor (legacy
 * .doc, PowerPoint, video) return empty text, which is an answer, not an error.
 */
export async function extractTextContent(
  attachment: Attachment,
  buffer: Buffer
): Promise<{ text: string; metadata: Record<string, unknown> }> {
  let text = '';
  let metadata: Record<string, unknown> = {};
  const filename = attachment.filename.toLowerCase();

  switch (attachment.file_type) {
    case 'pdf': {
      const pdfResult = await extractPDFText(buffer);
      text = pdfResult.text;
      metadata = {
        numPages: pdfResult.numPages,
        pdfMetadata: pdfResult.metadata,
      };
      break;
    }

    case 'document':
      if (attachment.mime_type.startsWith('text/')) {
        // Plain text files
        text = buffer.toString('utf-8');
      } else if (attachment.mime_type === WORD_DOCX || filename.endsWith('.docx')) {
        const wordResult = await extractWordText(buffer);
        text = wordResult.text;
        metadata = wordResult.metadata;
      } else if (
        EXCEL_TYPES.has(attachment.mime_type) ||
        filename.endsWith('.xlsx') ||
        filename.endsWith('.xls')
      ) {
        const excelResult = await extractExcelText(buffer);
        text = excelResult.text;
        metadata = excelResult.metadata;
      }
      break;

    case 'audio': {
      const result = await transcribeAudio(buffer, attachment.mime_type, attachment.user_id);
      text = result.text;
      if (result.skipped) metadata = { transcription: result.skipped };
      break;
    }

    default:
      break;
  }

  return { text: cleanExtractedText(text), metadata };
}
