import { api } from './api';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Attachment {
  id:            string;
  refType:       string;
  refId:         string;
  fileName:      string;
  storedName:    string;
  mimeType:      string;
  fileSizeBytes: number;
  uploadedBy:    string;
  uploader:      { id: string; fullName: string };
  isActive:      boolean;
  createdAt:     string;
}

// ─── API ──────────────────────────────────────────────────────────────────────

export const attachmentsApi = {
  /** Upload a file and associate it with refType + refId */
  upload: (refType: string, refId: string, file: File): Promise<Attachment> => {
    const form = new FormData();
    form.append('file', file);
    form.append('refType', refType);
    form.append('refId', refId);
    return api.post('/attachments', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data);
  },

  /** List active attachments for a ref */
  list: (refType: string, refId: string): Promise<Attachment[]> =>
    api.get(`/attachments/${refType}/${refId}`).then((r) => r.data),

  /** Soft-delete an attachment (ADMIN / MANAGER only) */
  delete: (id: string): Promise<Attachment> =>
    api.delete(`/attachments/${id}`).then((r) => r.data),
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function getFileUrl(storedName: string): string {
  return `http://localhost:4000/uploads/${storedName}`;
}

export function isImage(mimeType: string): boolean {
  return ['image/jpeg', 'image/png', 'image/webp'].includes(mimeType);
}

export function isPDF(mimeType: string): boolean {
  return mimeType === 'application/pdf';
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
