import { Router } from 'express';
import multer from 'multer';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import * as ctrl from './import.controller.js';

export const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel',   // .xls
      'text/csv',
      'text/plain',
      'application/csv',
      'application/octet-stream',   // some browsers send this for csv
    ];
    if (allowed.includes(file.mimetype) || file.originalname.match(/\.(xlsx?|csv)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Only .xlsx and .csv files are allowed'));
    }
  },
});

router.use(requireAuth);

// POST /api/v1/import/preview
router.post(
  '/preview',
  requirePermission('manage_users'),   // ADMIN only
  upload.single('file'),
  asyncHandler(ctrl.preview),
);

// POST /api/v1/import/confirm
router.post(
  '/confirm',
  requirePermission('manage_users'),   // ADMIN only
  upload.single('file'),
  asyncHandler(ctrl.confirm),
);
