import path from 'path';

// ─── Where uploaded files live ────────────────────────────────────────────────
//
// One resolution, used by everything that touches the upload directory.
//
// This existed in three places and one of them was wrong: multer wrote to
// `UPLOAD_PATH`, the download route served from `UPLOAD_PATH`, but
// attachment.service deleted from a hardcoded `path.resolve('uploads')`. Under
// Electron those are different directories — main.js sets
// UPLOAD_PATH=C:\ProgramData\ModernERP\uploads while spawning the backend with
// cwd set to the install folder — so every delete silently missed its file and
// the directory grew without bound.
//
// Resolved per call rather than cached at import: the value is read from the
// environment, and a cached copy would freeze whatever was set at module-load
// order, which is exactly the kind of thing that differs between the packaged
// app and a dev run.
export function uploadsDir(): string {
  return process.env.UPLOAD_PATH ?? path.resolve('uploads');
}

/** Absolute path of one stored file. `storedName` must already be a bare filename. */
export function uploadedFilePath(storedName: string): string {
  return path.join(uploadsDir(), path.basename(storedName));
}
