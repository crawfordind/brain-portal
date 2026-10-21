'use client';

import { useState, useCallback, useRef } from 'react';
import { Upload, X, File as FileIcon, Image, FileText, Music, Video, Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { Attachment } from '@/lib/db/schema';
import { uploadAttachment, UploadError } from '@/lib/attachments/upload-client';
import { FILE_SIZE_LIMITS, formatFileSize } from '@/lib/storage/upload-policy';

interface FileUploadProps {
  onUploadComplete?: (attachment: Attachment) => void;
  onUploadError?: (error: string) => void;
  projectId?: string | null;
  noteId?: string | null;
  /** Most files uploading at once. Finished files don't count against it. */
  maxFiles?: number;
  accept?: string;
  className?: string;
}

interface UploadingFile {
  id: string;
  file: File;
  progress: number;
  status: 'pending' | 'uploading' | 'success' | 'error';
  error?: string;
  retryable?: boolean;
  attachment?: Attachment;
}

/**
 * Images larger than this are not even tried in the browser: decoding a huge
 * photo to compress it can exhaust a phone's memory. Smaller ones are scaled
 * down and usually land far under the server's image limit.
 */
const MAX_IMAGE_BEFORE_COMPRESSION = 50 * 1024 * 1024;

/** Types the browser can decode and re-encode. HEIC and GIF (maybe animated) are sent as they are. */
const COMPRESSIBLE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

let nextUploadId = 0;

async function compressImage(file: File): Promise<File> {
  if (!COMPRESSIBLE_IMAGE_TYPES.has(file.type)) return file;
  // Already small: re-encoding would only cost quality
  if (file.size <= 1.5 * 1024 * 1024) return file;

  try {
    const { default: imageCompression } = await import('browser-image-compression');
    const compressed = await imageCompression(file, {
      maxSizeMB: 3, // Max 3MB
      maxWidthOrHeight: 2048, // Max dimension 2048px
      useWebWorker: true,
      fileType: 'image/webp', // Convert to WebP
      initialQuality: 0.9, // High quality
    });

    // Keep whichever is smaller; a re-encode is not guaranteed to win
    if (compressed.size >= file.size) return file;

    const newFileName = file.name.replace(/\.[^.]+$/, '') + '.webp';
    return new File([compressed], newFileName, {
      type: 'image/webp',
      lastModified: file.lastModified,
    });
  } catch (error) {
    console.error('Image compression failed, using original:', error);
    return file;
  }
}

export function FileUpload({
  onUploadComplete,
  onUploadError,
  projectId,
  noteId,
  maxFiles = 5,
  accept,
  className,
}: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Read from inside async handlers, where state would be stale
  const inFlightRef = useRef(0);

  const getFileIcon = (file: File) => {
    const type = file.type;
    if (type.startsWith('image/')) return Image;
    if (type.startsWith('audio/')) return Music;
    if (type.startsWith('video/')) return Video;
    if (type === 'application/pdf') return FileText;
    return FileIcon;
  };

  const update = useCallback((id: string, patch: Partial<UploadingFile>) => {
    setUploadingFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }, []);

  /** Expects `inFlightRef` to already count this file (see handleFiles and retryFile). */
  const runUpload = useCallback(
    async (id: string, originalFile: File) => {
      update(id, { status: 'uploading', progress: 0, error: undefined });

      try {
        const file = originalFile.type.startsWith('image/')
          ? await compressImage(originalFile)
          : originalFile;

        const result = await uploadAttachment(file, {
          noteId,
          projectId,
          onProgress: (fraction) => update(id, { progress: Math.round(fraction * 100) }),
        });

        update(id, { status: 'success', progress: 100, attachment: result.attachment });
        onUploadComplete?.(result.attachment);
        toast.success(
          result.deduplicated
            ? `Already attached: ${originalFile.name}`
            : `Uploaded: ${originalFile.name}`
        );
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Upload failed';
        const retryable = error instanceof UploadError ? error.retryable : true;
        update(id, { status: 'error', error: errorMessage, retryable });
        onUploadError?.(errorMessage);
        toast.error(`Failed to upload ${originalFile.name}: ${errorMessage}`);
      } finally {
        inFlightRef.current -= 1;
      }
    },
    [noteId, projectId, onUploadComplete, onUploadError, update]
  );

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const fileArray = Array.from(files);

      if (inFlightRef.current + fileArray.length > maxFiles) {
        toast.error(`Upload up to ${maxFiles} files at a time`);
        return;
      }

      // Refuse what cannot work before spending bandwidth on it. Images get
      // headroom because they are compressed first.
      const validFiles: File[] = [];
      for (const file of fileArray) {
        if (file.size === 0) {
          toast.error(`${file.name}: the file is empty`);
        } else if (file.type.startsWith('image/') && file.size > MAX_IMAGE_BEFORE_COMPRESSION) {
          toast.error(`${file.name}: images can be up to ${formatFileSize(FILE_SIZE_LIMITS.image)}`);
        } else {
          validFiles.push(file);
        }
      }
      if (validFiles.length === 0) return;

      const entries: UploadingFile[] = validFiles.map((file) => ({
        id: `upload-${++nextUploadId}`,
        file,
        progress: 0,
        status: 'pending',
      }));
      setUploadingFiles((prev) => [...prev, ...entries]);
      // Counted now, not as each starts, so files waiting their turn count too
      inFlightRef.current += entries.length;

      // One at a time: parallel uploads on a phone connection mostly slow each other down
      for (const entry of entries) {
        await runUpload(entry.id, entry.file);
      }
    },
    [maxFiles, runUpload]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const files = e.dataTransfer.files;
      if (files.length > 0) {
        handleFiles(files);
      }
    },
    [handleFiles]
  );

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        // Copy before resetting the input, which empties the live FileList
        handleFiles(Array.from(files));
      }
      // Reset input value to allow re-uploading the same file
      e.target.value = '';
    },
    [handleFiles]
  );

  const removeFile = (id: string) => {
    setUploadingFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const retryFile = (entry: UploadingFile) => {
    inFlightRef.current += 1;
    runUpload(entry.id, entry.file);
  };

  const clearCompleted = () => {
    setUploadingFiles((prev) => prev.filter((f) => f.status !== 'success'));
  };

  const remaining = uploadingFiles.filter((f) => f.status === 'pending' || f.status === 'uploading').length;

  return (
    <div className={cn('space-y-4', className)}>
      {/* Drop Zone */}
      <div
        role="button"
        tabIndex={0}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
        className={cn(
          'relative border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors',
          isDragging
            ? 'border-primary bg-primary/5'
            : 'border-muted-foreground/25 hover:border-primary/50 hover:bg-accent/50'
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={accept}
          onChange={handleFileInputChange}
          className="hidden"
        />

        <div className="flex flex-col items-center gap-2">
          <div
            className={cn(
              'rounded-full p-3 transition-colors',
              isDragging ? 'bg-primary/10' : 'bg-muted'
            )}
          >
            <Upload className={cn('size-6', isDragging && 'text-primary')} />
          </div>

          <div className="space-y-1">
            <p className="text-sm font-medium">
              {isDragging ? 'Drop files here' : 'Click to upload or drag and drop'}
            </p>
            <p className="text-xs text-muted-foreground">
              Images, PDFs, audio, video, and documents (up to {formatFileSize(FILE_SIZE_LIMITS.video)})
            </p>
          </div>
        </div>
      </div>

      {/* Uploading Files List */}
      {uploadingFiles.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium" aria-live="polite">
              {remaining > 0
                ? `Uploading ${remaining} of ${uploadingFiles.length} files`
                : `${uploadingFiles.filter((f) => f.status === 'success').length} of ${uploadingFiles.length} uploaded`}
            </p>
            {uploadingFiles.some((f) => f.status === 'success') && (
              <Button variant="ghost" size="sm" onClick={clearCompleted}>
                Clear completed
              </Button>
            )}
          </div>

          <div className="space-y-2">
            {uploadingFiles.map((uploadingFile) => {
              const Icon = getFileIcon(uploadingFile.file);

              return (
                <div
                  key={uploadingFile.id}
                  className="flex items-center gap-3 p-3 border rounded-lg bg-card"
                >
                  <div className="shrink-0">
                    <Icon className="size-5 text-muted-foreground" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{uploadingFile.file.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatFileSize(uploadingFile.file.size)}
                      {uploadingFile.status === 'uploading' && ` · ${uploadingFile.progress}%`}
                    </p>

                    {/* Progress Bar */}
                    {(uploadingFile.status === 'uploading' || uploadingFile.status === 'pending') && (
                      <div
                        className="mt-2 h-1 bg-muted rounded-full overflow-hidden"
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={uploadingFile.progress}
                        aria-label={`Uploading ${uploadingFile.file.name}`}
                      >
                        <div
                          className="h-full bg-primary transition-all duration-300"
                          style={{ width: `${uploadingFile.progress}%` }}
                        />
                      </div>
                    )}

                    {/* Error Message */}
                    {uploadingFile.status === 'error' && uploadingFile.error && (
                      <p className="mt-1 text-xs text-destructive">{uploadingFile.error}</p>
                    )}
                  </div>

                  <div className="shrink-0 flex items-center gap-1">
                    {(uploadingFile.status === 'uploading' || uploadingFile.status === 'pending') && (
                      <Loader2 className="size-4 animate-spin text-primary" />
                    )}
                    {uploadingFile.status === 'success' && (
                      <div className="size-4 rounded-full bg-green-500 flex items-center justify-center">
                        <svg
                          className="size-3 text-white"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                      </div>
                    )}
                    {uploadingFile.status === 'error' && uploadingFile.retryable && (
                      <Button
                        variant="ghost"
                        size="touch-icon"
                        aria-label={`Retry ${uploadingFile.file.name}`}
                        onClick={() => retryFile(uploadingFile)}
                      >
                        <RotateCcw className="size-4" />
                      </Button>
                    )}
                    {uploadingFile.status === 'error' && (
                      <Button
                        variant="ghost"
                        size="touch-icon"
                        aria-label={`Dismiss ${uploadingFile.file.name}`}
                        onClick={() => removeFile(uploadingFile.id)}
                      >
                        <X className="size-4" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
