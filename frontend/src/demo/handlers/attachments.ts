// ─── Attachments ─────────────────────────────────────────────────────────────
//
// AttachmentPanel is mounted on Purchase detail, Supplier Payments and Purchase
// Returns — all reachable in the demo. With no handler its list call 404'd and
// the panel rendered a red "Could not load attachments." on every purchase
// order a client opened, which is a worse look than the feature simply being
// empty.
//
// Files are held in MEMORY, deliberately not in the demo database.
// `persist()` writes the whole store to localStorage on every mutation, and a
// couple of photographs would blow the ~5MB quota — which fails silently
// (persist swallows it), so the visitor's sales would quietly stop being saved.
// Losing attachments on reload is the cheaper failure, and it cannot corrupt
// anything else.

import { DemoHttpError, type DemoHandler } from '../http';
import { db } from '../support';
import { nextId } from '../db';

export interface DemoAttachment {
  id: string; refType: string; refId: string;
  fileName: string; storedName: string; mimeType: string; fileSizeBytes: number;
  uploadedBy: string; uploader: { id: string; fullName: string };
  isActive: boolean; createdAt: string;
}

/** Metadata, and the bytes as a blob URL keyed by storedName. */
const attachments: DemoAttachment[] = [];
const blobUrls = new Map<string, string>();

/** 4 MB — comfortably above a scanned delivery note, below anything alarming. */
const MAX_BYTES = 4 * 1024 * 1024;

function currentUser() {
  try {
    const raw = localStorage.getItem('modernerp-auth');
    const id = raw ? JSON.parse(raw)?.state?.user?.id : null;
    const u = db().users.find((x) => x.id === id);
    if (u) return { id: u.id, fullName: u.fullName };
  } catch { /* fall through */ }
  const first = db().users[0];
  return { id: first.id, fullName: first.fullName };
}

export const listAttachments: DemoHandler = ({ params }) =>
  attachments.filter(
    (a) => a.isActive && a.refType === params.refType && a.refId === params.refId,
  );

export const uploadAttachment: DemoHandler = async ({ body }) => {
  const form = body as FormData | undefined;
  if (!form || typeof form.get !== 'function') throw new DemoHttpError(400, 'No file was received.');

  const file = form.get('file') as File | null;
  const refType = String(form.get('refType') ?? '');
  const refId = String(form.get('refId') ?? '');
  if (!file || typeof file.arrayBuffer !== 'function') throw new DemoHttpError(400, 'No file was received.');
  if (!refType || !refId) throw new DemoHttpError(400, 'Missing refType or refId.');
  if (file.size > MAX_BYTES) {
    throw new DemoHttpError(400, `That file is ${(file.size / 1048576).toFixed(1)} MB — the limit is 4 MB.`);
  }

  const user = currentUser();
  const id = nextId('att');
  const storedName = `${id}-${file.name.replace(/[^A-Za-z0-9._-]/g, '_')}`;

  // A blob URL so the panel's "view" fetch can actually resolve — see the
  // /uploads/ interception in install.ts.
  blobUrls.set(storedName, URL.createObjectURL(file));

  const row: DemoAttachment = {
    id, refType, refId,
    fileName: file.name, storedName,
    mimeType: file.type || 'application/octet-stream',
    fileSizeBytes: file.size,
    uploadedBy: user.id, uploader: user,
    isActive: true, createdAt: new Date().toISOString(),
  };
  attachments.push(row);
  return row;
};

export const deleteAttachment: DemoHandler = ({ params }) => {
  const row = attachments.find((a) => a.id === params.id);
  if (!row) throw new DemoHttpError(404, 'Attachment not found');
  // Soft delete, as the real endpoint does — the row is returned, not removed.
  row.isActive = false;
  const url = blobUrls.get(row.storedName);
  if (url) { URL.revokeObjectURL(url); blobUrls.delete(row.storedName); }
  return row;
};

/** Resolve `/uploads/<storedName>` to the blob URL holding those bytes. */
export function blobUrlFor(storedName: string): string | undefined {
  return blobUrls.get(storedName);
}
