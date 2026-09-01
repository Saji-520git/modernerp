import fs from 'fs';
import path from 'path';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../middleware/error-handler.js';
import { logger } from '../../config/logger.js';
import { uploadedFilePath } from '../../utils/uploads-dir.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateAttachmentData {
  refType:       string;
  refId:         string;
  fileName:      string;
  storedName:    string;
  mimeType:      string;
  fileSizeBytes: number;
  uploadedBy:    string;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const attachmentService = {

  create: (data: CreateAttachmentData) =>
    (prisma as any).attachment.create({ data }),

  listByRef: (refType: string, refId: string) =>
    (prisma as any).attachment.findMany({
      where:   { refType, refId, isActive: true },
      orderBy: { createdAt: 'desc' },
      include: { uploader: { select: { id: true, fullName: true } } },
    }),

  getById: async (id: string) => {
    const att = await (prisma as any).attachment.findUnique({ where: { id } });
    if (!att || !att.isActive) throw new HttpError(404, 'Attachment not found');
    return att;
  },

  deleteAttachment: async (id: string) => {
    const att = await (prisma as any).attachment.findUnique({ where: { id } });
    if (!att || !att.isActive) throw new HttpError(404, 'Attachment not found');

    // Try to remove physical file — non-fatal if already missing
    try {
      fs.unlinkSync(uploadedFilePath(att.storedName));
    } catch (err) {
      logger.warn({ err, storedName: att.storedName }, 'Could not delete attachment file from disk');
    }

    return (prisma as any).attachment.update({
      where: { id },
      data:  { isActive: false },
    });
  },
};
