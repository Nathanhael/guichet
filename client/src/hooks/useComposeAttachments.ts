import { useCallback, useEffect, useRef, useState } from 'react';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_PENDING = 5;

export interface PendingFile {
  file: File;
  preview: string;
}

export interface UploadedAttachment {
  url: string;
  name: string;
  mimeType: string;
  size: number;
}

export type ComposeAttachmentError =
  | { code: 'file_too_large' }
  | { code: 'upload_failed'; detail?: string };

interface UseComposeAttachmentsParams {
  onError: (error: ComposeAttachmentError) => void;
}

interface DragProps {
  onDragEnter: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

export interface UseComposeAttachmentsResult {
  pendingFiles: PendingFile[];
  uploading: boolean;
  isDragOver: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  addFiles: (files: File[]) => void;
  removeFile: (index: number) => void;
  clearMedia: () => void;
  uploadFiles: () => Promise<UploadedAttachment[]>;
  handleFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handlePaste: (e: React.ClipboardEvent) => void;
  dragProps: DragProps;
}

/**
 * Owns the compose-area attachment workflow: pending-files list, drag-drop
 * state, paste-image capture, and the multipart upload call. Enforces the
 * 10 MB per-file size limit and 5-file cap. Errors surface through `onError`
 * so the parent can translate + toast; the hook stays i18n-agnostic.
 */
export function useComposeAttachments({
  onError,
}: UseComposeAttachmentsParams): UseComposeAttachmentsResult {
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const pendingFilesRef = useRef(pendingFiles);
  pendingFilesRef.current = pendingFiles;

  useEffect(() => {
    return () => {
      pendingFilesRef.current.forEach((pf) => URL.revokeObjectURL(pf.preview));
    };
  }, []);

  const addFiles = useCallback(
    (files: File[]) => {
      setPendingFiles((prev) => {
        const remaining = MAX_PENDING - prev.length;
        if (remaining <= 0) return prev;
        const oversized = files.filter((f) => f.size > MAX_FILE_SIZE);
        if (oversized.length > 0) onError({ code: 'file_too_large' });
        const valid = files.filter((f) => f.size <= MAX_FILE_SIZE);
        const toAdd = valid.slice(0, remaining).map((file) => ({
          file,
          preview: URL.createObjectURL(file),
        }));
        return [...prev, ...toAdd];
      });
    },
    [onError],
  );

  const removeFile = useCallback((index: number) => {
    setPendingFiles((prev) => {
      const removed = prev[index];
      if (removed) URL.revokeObjectURL(removed.preview);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const clearMedia = useCallback(() => {
    setPendingFiles((prev) => {
      prev.forEach((pf) => URL.revokeObjectURL(pf.preview));
      return [];
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const uploadFiles = useCallback(async (): Promise<UploadedAttachment[]> => {
    const currentFiles = pendingFilesRef.current;
    if (currentFiles.length === 0) return [];
    setUploading(true);
    try {
      const form = new FormData();
      for (const pf of currentFiles) {
        form.append('files', pf.file);
      }
      const res = await fetch('/api/v1/uploads/multi', {
        method: 'POST',
        credentials: 'include',
        body: form,
      });
      const data = await res.json();
      if (!res.ok) {
        const detail = typeof data?.error === 'string' ? data.error : undefined;
        console.error('Upload failed:', detail ?? 'unknown error');
        onError({ code: 'upload_failed', detail });
        return [];
      }
      return data as UploadedAttachment[];
    } catch {
      onError({ code: 'upload_failed' });
      return [];
    } finally {
      setUploading(false);
    }
  }, [onError]);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      if (files.length === 0) return;
      addFiles(files);
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    [addFiles],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const pastedFiles: File[] = [];
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) pastedFiles.push(file);
        }
      }
      if (pastedFiles.length > 0) {
        e.preventDefault();
        addFiles(pastedFiles);
      }
    },
    [addFiles],
  );

  const dragProps: DragProps = {
    onDragEnter: (e) => {
      e.preventDefault();
      setIsDragOver(true);
    },
    onDragOver: (e) => {
      e.preventDefault();
      try {
        e.dataTransfer.dropEffect = 'copy';
      } catch {
        /* some browsers throw on certain drag types */
      }
    },
    onDragLeave: (e) => {
      if (e.currentTarget.contains(e.relatedTarget as Node)) return;
      setIsDragOver(false);
    },
    onDrop: (e) => {
      e.preventDefault();
      setIsDragOver(false);
      const files = Array.from(e.dataTransfer.files).filter(Boolean);
      if (files.length > 0) addFiles(files);
    },
  };

  return {
    pendingFiles,
    uploading,
    isDragOver,
    fileInputRef,
    addFiles,
    removeFile,
    clearMedia,
    uploadFiles,
    handleFileChange,
    handlePaste,
    dragProps,
  };
}
