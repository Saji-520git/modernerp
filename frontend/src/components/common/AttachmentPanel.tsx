import { useState, useRef, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Upload, FileText, Trash2, ExternalLink, RefreshCw, Paperclip,
} from 'lucide-react';
import {
  attachmentsApi, getFileUrl, getAuthHeaders, isImage, formatFileSize,
  type Attachment,
} from '../../services/attachments';
import { useAuthStore } from '../../store/authStore';

// ─── AuthImage ─────────────────────────────────────────────────────────────────
// Fetches the image with the Bearer token and displays it via an object URL.
// Plain <img src="..."> does NOT send auth headers, so it would get a 401
// from the authenticated /uploads route.

function AuthImage({
  src,
  alt,
  className,
  onClick,
}: {
  src: string;
  alt: string;
  className?: string;
  onClick?: () => void;
}) {
  const [url, setUrl] = useState<string>('');
  const token = useAuthStore((s) => s.accessToken);

  useEffect(() => {
    let objectUrl = '';
    fetch(src, { headers: { Authorization: `Bearer ${token ?? ''}` } })
      .then((r) => r.blob())
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => setUrl(''));

    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src, token]);

  return url
    ? <img src={url} alt={alt} className={className} onClick={onClick} />
    : <div className={className} />;
}

// ─── openFileWithAuth ─────────────────────────────────────────────────────────
// window.open() does NOT send auth headers either, so we fetch the blob first
// and open the resulting object URL in a new tab.

async function openFileWithAuth(storedName: string): Promise<void> {
  try {
    const response = await fetch(getFileUrl(storedName), { headers: getAuthHeaders() });
    if (!response.ok) return;
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    window.open(objectUrl, '_blank');
    // Object URL is intentionally not revoked immediately so the new tab can render it.
    // Browsers clean up object URLs when the tab is closed.
  } catch {
    // Silently ignore — user sees no file open
  }
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  refType:    string;
  refId:      string;
  canDelete?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AttachmentPanel({ refType, refId, canDelete = true }: Props) {
  const qc          = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadErr,  setUploadErr]  = useState<string | null>(null);

  // ── fetch ──────────────────────────────────────────────────────────────────

  const { data: attachments = [], isLoading, isError } = useQuery<Attachment[]>({
    queryKey: ['attachments', refType, refId],
    queryFn:  () => attachmentsApi.list(refType, refId),
  });

  // ── upload ─────────────────────────────────────────────────────────────────

  const uploadMut = useMutation({
    mutationFn: (file: File) => attachmentsApi.upload(refType, refId, file),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['attachments', refType, refId] });
      setUploadErr(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
        ?? (err instanceof Error ? err.message : 'Upload failed');
      setUploadErr(msg);
    },
  });

  // ── delete ─────────────────────────────────────────────────────────────────

  const deleteMut = useMutation({
    mutationFn: (id: string) => attachmentsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['attachments', refType, refId] });
    },
  });

  // ── handlers ───────────────────────────────────────────────────────────────

  const handleFiles = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    uploadMut.mutate(files[0]);
  }, [uploadMut]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const handleDelete = (att: Attachment) => {
    if (!window.confirm(`Delete "${att.fileName}"? This cannot be undone.`)) return;
    deleteMut.mutate(att.id);
  };

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div className="border-t border-slate-100 pt-4 mt-4">
      {/* Section header */}
      <div className="flex items-center gap-2 mb-3">
        <Paperclip size={13} className="text-slate-400" />
        <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Attachments</h4>
        {attachments.length > 0 && (
          <span className="text-[10px] font-bold bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full">
            {attachments.length}
          </span>
        )}
      </div>

      {/* Upload zone */}
      <div
        className={`border-2 border-dashed rounded-xl p-3 text-center transition cursor-pointer mb-3 ${
          isDragging
            ? 'border-indigo-400 bg-indigo-50'
            : 'border-slate-200 hover:border-indigo-300 hover:bg-slate-50'
        }`}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".jpg,.jpeg,.png,.webp,.pdf"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        {uploadMut.isPending ? (
          <div className="flex items-center justify-center gap-2 text-indigo-600 py-1">
            <RefreshCw size={13} className="animate-spin" />
            <span className="text-xs font-medium">Uploading…</span>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-2 text-slate-400 py-1">
            <Upload size={13} />
            <span className="text-xs">Drop file or click to upload</span>
          </div>
        )}
        <p className="text-[10px] text-slate-300 mt-0.5">JPG, PNG, WEBP or PDF · max 5 MB</p>
      </div>

      {uploadErr && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-2">
          {uploadErr}
        </p>
      )}

      {/* File list */}
      {isLoading ? (
        <div className="flex items-center gap-1.5 text-xs text-slate-400 py-2">
          <RefreshCw size={11} className="animate-spin" /> Loading attachments…
        </div>
      ) : isError ? (
        <p className="text-xs text-red-500 py-2">Could not load attachments.</p>
      ) : attachments.length === 0 ? (
        <p className="text-xs text-slate-400 text-center py-3">No attachments yet</p>
      ) : (
        <div className="space-y-2">
          {attachments.map((att) => (
            <div
              key={att.id}
              className="flex items-center gap-2.5 p-2 bg-slate-50 rounded-xl hover:bg-slate-100 transition group"
            >
              {/* Preview / icon */}
              {isImage(att.mimeType) ? (
                <AuthImage
                  src={getFileUrl(att.storedName)}
                  alt={att.fileName}
                  className="w-11 h-11 object-cover rounded-lg shrink-0 cursor-pointer hover:opacity-80 transition"
                  onClick={() => openFileWithAuth(att.storedName)}
                />
              ) : (
                <div
                  className="w-11 h-11 bg-red-50 border border-red-100 rounded-lg flex items-center justify-center shrink-0 cursor-pointer hover:bg-red-100 transition"
                  onClick={() => openFileWithAuth(att.storedName)}
                >
                  <FileText size={20} className="text-red-500" />
                </div>
              )}

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-slate-700 truncate">{att.fileName}</p>
                <p className="text-[10px] text-slate-400">
                  {formatFileSize(att.fileSizeBytes)} · {att.uploader.fullName}
                </p>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 shrink-0">
                {/* Open in new tab — uses fetch+blob so the auth header is included */}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); openFileWithAuth(att.storedName); }}
                  className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition"
                  title="Open in new tab"
                >
                  <ExternalLink size={12} />
                </button>
                {canDelete && (
                  <button
                    onClick={() => handleDelete(att)}
                    disabled={deleteMut.isPending}
                    className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition disabled:opacity-50"
                    title="Delete attachment"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
