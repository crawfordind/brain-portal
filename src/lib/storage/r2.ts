import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const R2_ENV_VARS = [
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET_NAME',
  'R2_PUBLIC_URL',
] as const;

/**
 * The R2 variables that are not set. Empty means uploads can work. Names only,
 * never values, so it is safe to show an admin.
 */
export function missingR2Config(env: Record<string, string | undefined> = process.env): string[] {
  return R2_ENV_VARS.filter((name) => !env[name]?.trim());
}

export function isR2Configured(): boolean {
  return missingR2Config().length === 0;
}

// Lazy-load R2 client to avoid initialization errors when env vars are missing
let r2Client: S3Client | null = null;

export function getR2Client(): S3Client {
  if (!r2Client) {
    if (!process.env.R2_ACCOUNT_ID) {
      throw new Error('R2_ACCOUNT_ID environment variable is not set');
    }
    if (!process.env.R2_ACCESS_KEY_ID) {
      throw new Error('R2_ACCESS_KEY_ID environment variable is not set');
    }
    if (!process.env.R2_SECRET_ACCESS_KEY) {
      throw new Error('R2_SECRET_ACCESS_KEY environment variable is not set');
    }

    r2Client = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
      // AWS SDK v3.729+ adds CRC32 checksums to every request by default, and
      // bakes a checksum of an *empty* body into presigned PUT URLs, which R2
      // then rejects when the browser sends the real file. Cloudflare's own
      // guidance is to send checksums only when an operation requires them.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }
  return r2Client;
}

export function getBucketName(): string {
  const bucketName = process.env.R2_BUCKET_NAME;
  if (!bucketName) {
    throw new Error('R2_BUCKET_NAME environment variable is not set');
  }
  return bucketName;
}

function getPublicUrl(): string {
  const publicUrl = process.env.R2_PUBLIC_URL;
  if (!publicUrl) {
    throw new Error('R2_PUBLIC_URL environment variable is not set');
  }
  return publicUrl;
}

/**
 * Upload a file to Cloudflare R2 storage
 * @param key - The object key (path) in R2, e.g., "user_id/filename.ext"
 * @param file - The file buffer to upload
 * @param contentType - MIME type of the file
 * @returns Public URL of the uploaded file
 */
export async function uploadToR2(
  key: string,
  file: Buffer,
  contentType: string
): Promise<string> {
  const client = getR2Client();
  const bucket = getBucketName();

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: file,
      ContentType: contentType,
    })
  );

  return publicUrlFor(key);
}

/** The public URL an object is served from. */
export function publicUrlFor(key: string): string {
  return `${getPublicUrl().replace(/\/+$/, '')}/${key}`;
}

/**
 * A URL the browser can PUT one file to, straight into the bucket. The
 * Content-Type is signed, so the object is stored under the type the server
 * chose and the browser must send exactly that header. Needs a CORS rule on
 * the bucket allowing PUT from the app's origin (`npm run r2:cors`).
 */
export async function getPresignedUploadUrl(
  key: string,
  contentType: string,
  expiresIn: number = 900
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: getBucketName(),
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(getR2Client(), command, { expiresIn });
}

/**
 * Download an object, refusing anything larger than `maxBytes`. Reads the
 * size from the response before buffering, and stops reading past the cap,
 * so a file that grew (or lied) cannot exhaust the function's memory.
 */
export async function downloadFromR2(key: string, maxBytes?: number): Promise<Buffer> {
  const response = await getR2Client().send(
    new GetObjectCommand({ Bucket: getBucketName(), Key: key })
  );

  if (!response.Body) {
    throw new Error('Failed to download file from R2');
  }
  if (maxBytes !== undefined && (response.ContentLength ?? 0) > maxBytes) {
    throw new Error(`Stored file is larger than ${maxBytes} bytes`);
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
    total += chunk.length;
    if (maxBytes !== undefined && total > maxBytes) {
      throw new Error(`Stored file is larger than ${maxBytes} bytes`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Delete a file from Cloudflare R2 storage
 * @param key - The object key (path) in R2
 */
export async function deleteFromR2(key: string): Promise<void> {
  const client = getR2Client();
  const bucket = getBucketName();

  await client.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    })
  );
}

/**
 * Generate a presigned URL for downloading a file
 * @param key - The object key (path) in R2
 * @param expiresIn - Expiration time in seconds (default: 1 hour)
 * @returns Presigned download URL
 */
export async function getPresignedDownloadUrl(
  key: string,
  expiresIn: number = 3600
): Promise<string> {
  const client = getR2Client();
  const bucket = getBucketName();

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  return getSignedUrl(client, command, { expiresIn });
}

/**
 * Check if a file exists in R2 storage
 * @param key - The object key (path) in R2
 * @returns True if the file exists, false otherwise
 */
export async function fileExistsInR2(key: string): Promise<boolean> {
  const client = getR2Client();
  const bucket = getBucketName();

  try {
    await client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: key,
      })
    );
    return true;
  } catch {
    // HeadObject throws an error if the object doesn't exist
    return false;
  }
}

/**
 * Get file metadata from R2 storage
 * @param key - The object key (path) in R2
 * @returns Object metadata including content type, size, etc.
 */
export async function getFileMetadata(key: string): Promise<{
  contentType?: string;
  contentLength?: number;
  lastModified?: Date;
} | null> {
  const client = getR2Client();
  const bucket = getBucketName();

  let response;
  try {
    response = await client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: key,
      })
    );
  } catch (error) {
    // A missing object is an answer (null), not a failure
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404 || (error as { name?: string }).name === 'NotFound') return null;
    throw error;
  }

  return {
    contentType: response.ContentType,
    contentLength: response.ContentLength,
    lastModified: response.LastModified,
  };
}
