import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Lazy-load R2 client to avoid initialization errors when env vars are missing
let r2Client: S3Client | null = null;

function getR2Client(): S3Client {
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
    });
  }
  return r2Client;
}

function getBucketName(): string {
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

  const publicUrl = getPublicUrl();
  return `${publicUrl}/${key}`;
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
  } catch (error) {
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
}> {
  const client = getR2Client();
  const bucket = getBucketName();

  const response = await client.send(
    new HeadObjectCommand({
      Bucket: bucket,
      Key: key,
    })
  );

  return {
    contentType: response.ContentType,
    contentLength: response.ContentLength,
    lastModified: response.LastModified,
  };
}
