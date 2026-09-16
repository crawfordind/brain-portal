'use client';

import { useState, useCallback, useRef } from 'react';
import { Upload, X, File as FileIcon, Image, FileText, Music, Video, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import imageCompression from 'browser-image-compression';

interface FileUploadProps {
  onUploadComplete?: (attachment: any) => void;
  onUploadError?: (error: string) => void;
  projectId?: string | null;
  noteId?: string | null;
  maxFiles?: number;
  accept?: string;
  className?: string;
}

interface UploadingFile {
  file: File;
  progress: number;
  status: 'pending' | 'uploading' | 'success' | 'error';
  error?: string;
  attachment?: any;
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

  const getFileIcon = (file: File) => {
    const type = file.type;
    if (type.startsWith('image/')) return Image;
    if (type.startsWith('audio/')) return Music;
    if (type.startsWith('video/')) return Video;
    if (type === 'application/pdf') return FileText;
    return FileIcon;
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const compressImage = async (file: File): Promise<File> => {
    // Only compress images
    if (!file.type.startsWith('image/')) {
      return file;
    }

    // Skip GIFs (might be animated)
    if (file.type === 'image/gif') {
      return file;
    }

    try {
      const options = {
        maxSizeMB: 3, // Max 3MB
        maxWidthOrHeight: 2048, // Max dimension 2048px
        useWebWorker: true,
        fileType: 'image/webp', // Convert to WebP
        initialQuality: 0.9, // High quality
        preserveExif: true, // Keep EXIF metadata
      };

      const compressedFile = await imageCompression(file, options);

      // Rename the file to have .webp extension
      const newFileName = file.name.replace(/\.[^.]+$/, '.webp');
      const renamedFile = new File([compressedFile], newFileName, {
        type: 'image/webp',
        lastModified: Date.now(),
      });

      console.log(`Compressed ${file.name}: ${formatFileSize(file.size)} → ${formatFileSize(renamedFile.size)}`);
      return renamedFile;
    } catch (error) {
      console.error('Image compression failed, using original:', error);
      return file;
    }
  };

  const uploadFile = async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    if (projectId) formData.append('projectId', projectId);
    if (noteId) formData.append('noteId', noteId);

    const response = await fetch('/api/attachments', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      // Get response text first (can parse as JSON later)
      const text = await response.text();

      // Try to parse as JSON
      try {
        const error = JSON.parse(text);
        throw new Error(error.error || 'Upload failed');
      } catch (parseError) {
        // If not JSON, use the text directly (might be HTML or plain text error)
        const errorMsg = text.length > 200 ? text.substring(0, 200) + '...' : text;
        throw new Error(errorMsg || `Upload failed (${response.status})`);
      }
    }

    // Try to parse success response as JSON
    try {
      return await response.json();
    } catch (parseError) {
      throw new Error('Server returned invalid JSON response');
    }
  };

  const validateFileSize = (file: File): { valid: boolean; error?: string } => {
    const maxSizes = {
      image: 20 * 1024 * 1024, // 20MB for images (will be compressed)
      pdf: 10 * 1024 * 1024,   // 10MB for PDFs
      audio: 25 * 1024 * 1024, // 25MB for audio
      video: 50 * 1024 * 1024, // 50MB for video
      document: 10 * 1024 * 1024, // 10MB for documents
      other: 10 * 1024 * 1024,    // 10MB for other files
    };

    let fileType: keyof typeof maxSizes = 'other';
    if (file.type.startsWith('image/')) fileType = 'image';
    else if (file.type === 'application/pdf') fileType = 'pdf';
    else if (file.type.startsWith('audio/')) fileType = 'audio';
    else if (file.type.startsWith('video/')) fileType = 'video';
    else if (
      file.type.includes('document') ||
      file.type.includes('word') ||
      file.type.includes('excel') ||
      file.type.includes('spreadsheet')
    ) fileType = 'document';

    const maxSize = maxSizes[fileType];

    if (file.size > maxSize) {
      return {
        valid: false,
        error: `File too large. Maximum ${formatFileSize(maxSize)} allowed for ${fileType} files.`,
      };
    }

    return { valid: true };
  };

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const fileArray = Array.from(files);

      // Check max files
      if (uploadingFiles.length + fileArray.length > maxFiles) {
        toast.error(`Maximum ${maxFiles} files allowed`);
        return;
      }

      // Validate file sizes before adding to queue
      const validFiles: File[] = [];
      for (const file of fileArray) {
        const validation = validateFileSize(file);
        if (!validation.valid) {
          toast.error(`${file.name}: ${validation.error}`);
        } else {
          validFiles.push(file);
        }
      }

      // If no valid files, return early
      if (validFiles.length === 0) {
        return;
      }

      // Add only valid files to uploading state
      const newUploadingFiles: UploadingFile[] = validFiles.map((file) => ({
        file,
        progress: 0,
        status: 'pending',
      }));

      setUploadingFiles((prev) => [...prev, ...newUploadingFiles]);

      // Upload each valid file
      for (let i = 0; i < validFiles.length; i++) {
        const originalFile = validFiles[i];
        const fileIndex = uploadingFiles.length + i;

        try {
          // Update status to uploading
          setUploadingFiles((prev) =>
            prev.map((f, idx) =>
              idx === fileIndex ? { ...f, status: 'uploading', progress: 25 } : f
            )
          );

          // Compress image if needed
          const file = await compressImage(originalFile);

          // Update progress after compression
          setUploadingFiles((prev) =>
            prev.map((f, idx) =>
              idx === fileIndex ? { ...f, progress: 50 } : f
            )
          );

          const result = await uploadFile(file);

          // Update status to success
          setUploadingFiles((prev) =>
            prev.map((f, idx) =>
              idx === fileIndex
                ? { ...f, status: 'success', progress: 100, attachment: result.attachment }
                : f
            )
          );

          onUploadComplete?.(result.attachment);
          toast.success(
            result.deduplicated
              ? `File already exists: ${file.name}`
              : `Uploaded: ${file.name}`
          );
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Upload failed';

          // Update status to error
          setUploadingFiles((prev) =>
            prev.map((f, idx) =>
              idx === fileIndex ? { ...f, status: 'error', error: errorMessage } : f
            )
          );

          onUploadError?.(errorMessage);
          toast.error(`Failed to upload ${originalFile.name}: ${errorMessage}`);
        }
      }
    },
    [uploadingFiles.length, maxFiles, projectId, noteId, onUploadComplete, onUploadError]
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
        handleFiles(files);
      }
      // Reset input value to allow re-uploading the same file
      e.target.value = '';
    },
    [handleFiles]
  );

  const removeFile = (index: number) => {
    setUploadingFiles((prev) => prev.filter((_, idx) => idx !== index));
  };

  const clearCompleted = () => {
    setUploadingFiles((prev) => prev.filter((f) => f.status !== 'success'));
  };

  return (
    <div className={cn('space-y-4', className)}>
      {/* Drop Zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
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
              Images, PDFs, audio, video, and documents
            </p>
          </div>
        </div>
      </div>

      {/* Uploading Files List */}
      {uploadingFiles.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">
              Uploading {uploadingFiles.filter((f) => f.status !== 'success').length} of{' '}
              {uploadingFiles.length} files
            </p>
            {uploadingFiles.some((f) => f.status === 'success') && (
              <Button variant="ghost" size="sm" onClick={clearCompleted}>
                Clear completed
              </Button>
            )}
          </div>

          <div className="space-y-2">
            {uploadingFiles.map((uploadingFile, index) => {
              const Icon = getFileIcon(uploadingFile.file);

              return (
                <div
                  key={index}
                  className="flex items-center gap-3 p-3 border rounded-lg bg-card"
                >
                  <div className="shrink-0">
                    <Icon className="size-5 text-muted-foreground" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{uploadingFile.file.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatFileSize(uploadingFile.file.size)}
                    </p>

                    {/* Progress Bar */}
                    {uploadingFile.status === 'uploading' && (
                      <div className="mt-2 h-1 bg-muted rounded-full overflow-hidden">
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

                  <div className="shrink-0">
                    {uploadingFile.status === 'uploading' && (
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
                    {uploadingFile.status === 'error' && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => removeFile(index)}
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
