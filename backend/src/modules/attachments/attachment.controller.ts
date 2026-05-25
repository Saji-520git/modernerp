import type { RequestHandler } from 'express';
import { attachmentService } from './attachment.service.js';
import { HttpError } from '../../middleware/error-handler.js';

// ─── POST / ───────────────────────────────────────────────────────────────────

export const createAttachment: RequestHandler = async (req, res) => {
  if (!req.file) throw new HttpError(400, 'No file uploaded');

  const { refType, refId } = req.body as { refType?: string; refId?: string };
  if (!refType || !refId) throw new HttpError(400, 'refType and refId are required');

  const att = await attachmentService.create({
    refType,
    refId,
    fileName:      req.file.originalname,
    storedName:    req.file.filename,
    mimeType:      req.file.mimetype,
    fileSizeBytes: req.file.size,
    uploadedBy:    req.auth!.userId,
  });

  res.status(201).json(att);
};

// ─── GET /:refType/:refId ─────────────────────────────────────────────────────

export const listAttachments: RequestHandler = async (req, res) => {
  const { refType, refId } = req.params;
  const items = await attachmentService.listByRef(refType, refId);
  res.json(items);
};

// ─── DELETE /:id ──────────────────────────────────────────────────────────────

export const deleteAttachment: RequestHandler = async (req, res) => {
  const result = await attachmentService.deleteAttachment(req.params.id);
  res.json(result);
};
