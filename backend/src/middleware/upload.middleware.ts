import multer from 'multer';
import path from 'path';
import { randomUUID } from 'crypto';

// ─── Allowed MIME types ───────────────────────────────────────────────────────

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

// ─── Disk storage ─────────────────────────────────────────────────────────────

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, path.resolve('uploads'));
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${randomUUID()}${ext}`);
  },
});

// ─── Export ───────────────────────────────────────────────────────────────────

export const uploadMiddleware = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPG, PNG, WEBP and PDF files allowed'));
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});
