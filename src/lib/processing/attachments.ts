import { getModelChain } from '@/lib/ai/models';
/**
 * Content processing for attachments
 * Handles extraction of text, metadata, thumbnails, and descriptions
 */

import sharp from 'sharp';
import pdfParse from 'pdf-parse';
import exifReader from 'exif-reader';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import type { Attachment } from '@/lib/db/schema';

/**
 * Get R2 client (same as in r2.ts but for server-side processing)
 */
function getR2Client(): S3Client {
  if (!process.env.R2_ACCOUNT_ID) {
    throw new Error('R2_ACCOUNT_ID environment variable is not set');
  }
  if (!process.env.R2_ACCESS_KEY_ID) {
    throw new Error('R2_ACCESS_KEY_ID environment variable is not set');
  }
  if (!process.env.R2_SECRET_ACCESS_KEY) {
    throw new Error('R2_SECRET_ACCESS_KEY environment variable is not set');
  }

  return new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
}

/**
 * Download file from R2 storage
 */
export async function downloadFromR2(storageKey: string): Promise<Buffer> {
  const client = getR2Client();
  const bucketName = process.env.R2_BUCKET_NAME;

  if (!bucketName) {
    throw new Error('R2_BUCKET_NAME environment variable is not set');
  }

  const response = await client.send(
    new GetObjectCommand({
      Bucket: bucketName,
      Key: storageKey,
    })
  );

  if (!response.Body) {
    throw new Error('Failed to download file from R2');
  }

  // Convert stream to buffer
  const chunks: Uint8Array[] = [];
  for await (const chunk of response.Body as any) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Extract EXIF metadata from images
 */
export async function extractImageMetadata(
  buffer: Buffer
): Promise<Record<string, any>> {
  try {
    const metadata = await sharp(buffer).metadata();

    const result: Record<string, any> = {
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
  } catch (error) {
    console.error('Failed to extract image metadata:', error);
    return {};
  }
}

/**
 * Generate thumbnail for images
 * Returns base64-encoded thumbnail data
 */
export async function generateThumbnail(
  buffer: Buffer,
  size: number = 300
): Promise<string> {
  try {
    const thumbnail = await sharp(buffer)
      .resize(size, size, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 80 })
      .toBuffer();

    return thumbnail.toString('base64');
  } catch (error) {
    console.error('Failed to generate thumbnail:', error);
    throw error;
  }
}

/**
 * Extract text from PDF files
 */
export async function extractPDFText(buffer: Buffer): Promise<{
  text: string;
  numPages: number;
  metadata: Record<string, any>;
}> {
  try {
    const data = await pdfParse(buffer);

    return {
      text: data.text,
      numPages: data.numpages,
      metadata: data.info || {},
    };
  } catch (error) {
    console.error('Failed to extract PDF text:', error);
    throw error;
  }
}

/**
 * Extract text from Word documents (.docx)
 */
export async function extractWordText(buffer: Buffer): Promise<{
  text: string;
  metadata: Record<string, any>;
}> {
  try {
    const result = await mammoth.extractRawText({ buffer });

    return {
      text: result.value,
      metadata: {
        messages: result.messages,
      },
    };
  } catch (error) {
    console.error('Failed to extract Word text:', error);
    throw error;
  }
}

/**
 * Extract text from Excel spreadsheets (.xlsx, .xls)
 */
export async function extractExcelText(buffer: Buffer): Promise<{
  text: string;
  metadata: Record<string, any>;
}> {
  try {
    const workbook = XLSX.read(buffer, { type: 'buffer' });

    const allText: string[] = [];
    const sheetNames: string[] = [];

    workbook.SheetNames.forEach((sheetName) => {
      sheetNames.push(sheetName);
      const worksheet = workbook.Sheets[sheetName];

      // Convert sheet to CSV text
      const csv = XLSX.utils.sheet_to_csv(worksheet);
      allText.push(`=== ${sheetName} ===\n${csv}`);
    });

    return {
      text: allText.join('\n\n'),
      metadata: {
        sheetNames,
        numSheets: workbook.SheetNames.length,
      },
    };
  } catch (error) {
    console.error('Failed to extract Excel text:', error);
    throw error;
  }
}

/**
 * Generate AI description for images using vision model
 * This would call OpenRouter with a vision-capable model
 */
export async function generateImageDescription(
  buffer: Buffer,
  filename: string
): Promise<string> {
  // TODO: Implement with OpenRouter vision API
  // For now, return a placeholder
  // This should be called from the fast_llm tier

  // Convert image to base64 for API
  const base64Image = buffer.toString('base64');
  const mimeType = filename.toLowerCase().endsWith('.png')
    ? 'image/png'
    : filename.toLowerCase().endsWith('.gif')
    ? 'image/gif'
    : filename.toLowerCase().endsWith('.webp')
    ? 'image/webp'
    : 'image/jpeg';

  // Call OpenRouter with vision model (GPT-4V, Claude 3, etc.)
  try {
    const openai = await import('openai');
    const client = new openai.default({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: process.env.OPENROUTER_API_KEY,
    });

    // Resolved from the vision slot rather than pinned here: a hardcoded id is
    // what breaks silently when a provider retires it, and the chain gives this
    // call a fallback.
    const visionChain = await getModelChain('vision');

    const response = await client.chat.completions.create({
      model: visionChain[0],
      ...(visionChain.length > 1 ? { models: visionChain } : {}),
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Describe this image in 2-3 sentences. Focus on the main subject, key details, and any text visible in the image.',
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${base64Image}`,
              },
            },
          ],
        },
      ],
      max_tokens: 150,
    });

    return response.choices[0]?.message?.content || '';
  } catch (error) {
    console.error('Failed to generate image description:', error);
    return '';
  }
}

/**
 * Transcribe audio files using Gemini Flash
 * Uses google/gemini-3-flash-preview for fast audio transcription
 */
export async function transcribeAudio(
  buffer: Buffer,
  filename: string
): Promise<string> {
  try {
    const openai = await import('openai');
    const client = new openai.default({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: process.env.OPENROUTER_API_KEY,
    });

    // Determine audio MIME type from filename
    const ext = filename.toLowerCase().split('.').pop();
    const mimeType =
      ext === 'mp3' ? 'audio/mpeg' :
      ext === 'wav' ? 'audio/wav' :
      ext === 'm4a' ? 'audio/mp4' :
      ext === 'ogg' ? 'audio/ogg' :
      ext === 'webm' ? 'audio/webm' :
      'audio/mpeg'; // default

    // Convert to base64
    const base64Audio = buffer.toString('base64');

    // Was pinned to google/gemini-flash-1.5-exp — an "-exp" preview id, exactly
    // the kind providers withdraw without notice. Now it follows the vision
    // slot, which is validated against the live catalog on every call.
    const audioChain = await getModelChain('vision');

    const response = await client.chat.completions.create({
      model: audioChain[0],
      ...(audioChain.length > 1 ? { models: audioChain } : {}),
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Transcribe this audio file. Provide only the transcription text, no additional commentary.',
            },
            {
              type: 'image_url', // OpenRouter uses image_url for all media
              image_url: {
                url: `data:${mimeType};base64,${base64Audio}`,
              },
            },
          ],
        },
      ],
      max_tokens: 2000,
    });

    return response.choices[0]?.message?.content || '';
  } catch (error) {
    console.error('Failed to transcribe audio:', error);
    return '';
  }
}

/**
 * Extract text content based on file type
 */
export async function extractTextContent(
  attachment: Attachment,
  buffer: Buffer
): Promise<{ text: string; metadata: Record<string, any> }> {
  let text = '';
  let metadata: Record<string, any> = {};

  switch (attachment.file_type) {
    case 'pdf':
      const pdfResult = await extractPDFText(buffer);
      text = pdfResult.text;
      metadata = {
        numPages: pdfResult.numPages,
        pdfMetadata: pdfResult.metadata,
      };
      break;

    case 'document':
      // Handle different document types
      if (
        attachment.mime_type.startsWith('text/') ||
        attachment.mime_type.includes('markdown')
      ) {
        // Plain text files
        text = buffer.toString('utf-8');
      } else if (
        attachment.mime_type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        attachment.filename.toLowerCase().endsWith('.docx')
      ) {
        // Word documents (.docx)
        const wordResult = await extractWordText(buffer);
        text = wordResult.text;
        metadata = wordResult.metadata;
      } else if (
        attachment.mime_type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        attachment.mime_type === 'application/vnd.ms-excel' ||
        attachment.filename.toLowerCase().endsWith('.xlsx') ||
        attachment.filename.toLowerCase().endsWith('.xls')
      ) {
        // Excel spreadsheets (.xlsx, .xls)
        const excelResult = await extractExcelText(buffer);
        text = excelResult.text;
        metadata = excelResult.metadata;
      }
      break;

    case 'audio':
      text = await transcribeAudio(buffer, attachment.filename);
      break;

    case 'image':
      // For images, we'll use OCR or vision API
      // This is handled separately in generateImageDescription
      break;

    default:
      break;
  }

  return { text, metadata };
}

/**
 * Process attachment metadata extraction (local tier - free)
 */
export async function processMetadataExtraction(
  attachment: Attachment
): Promise<{ metadata: Record<string, any> }> {
  const buffer = await downloadFromR2(attachment.storage_key);

  let metadata: Record<string, any> = {};

  if (attachment.file_type === 'image') {
    metadata = await extractImageMetadata(buffer);
  }

  return { metadata };
}

/**
 * Process thumbnail generation (local tier - free)
 */
export async function processThumbnailGeneration(
  attachment: Attachment
): Promise<{ thumbnail: string }> {
  if (attachment.file_type !== 'image') {
    throw new Error('Thumbnails can only be generated for images');
  }

  const buffer = await downloadFromR2(attachment.storage_key);
  const thumbnail = await generateThumbnail(buffer);

  return { thumbnail };
}

/**
 * Process text extraction (embedding/fast_llm tier)
 */
export async function processTextExtraction(
  attachment: Attachment
): Promise<{ text: string; metadata: Record<string, any> }> {
  const buffer = await downloadFromR2(attachment.storage_key);
  return extractTextContent(attachment, buffer);
}

/**
 * Process image description generation (fast_llm tier)
 */
export async function processDescriptionGeneration(
  attachment: Attachment
): Promise<{ description: string }> {
  if (attachment.file_type !== 'image') {
    throw new Error('Descriptions can only be generated for images');
  }

  const buffer = await downloadFromR2(attachment.storage_key);
  const description = await generateImageDescription(buffer, attachment.filename);

  return { description };
}
